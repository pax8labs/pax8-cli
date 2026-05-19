// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  ALL_SUBS_PAGE_SIZE,
  auditInvoices,
  ERROR_INVALID_INPUT,
  ERROR_INTERNAL,
  getConfigDir,
  safeWriteFileSync,
  type Pax8ErrorCode,
} from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { formatCurrency, formatQuantity } from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { confirm, replCmd } from "../../lib/confirm.js";
import { markWriteInFlight } from "../../lib/signals.js";
import { hashArgs, isValidKey, withIdempotency } from "../../lib/idempotency.js";

/**
 * NOTE: The Pax8 v1 API does not expose a public dispute / write-off / credit
 * endpoint for invoice line items (verified against
 * `packages/core/src/api/invoices.ts` — only GET endpoints exist). Pax8
 * billing disputes are handled out-of-band via the partner portal and support.
 *
 * Rather than fake an API call, this command closes the loop locally:
 *   1. Materializes a dispute draft as a JSON record under ~/.pax8/disputes/.
 *   2. Renders a portal-ready support ticket (markdown) the partner can paste
 *      into the Pax8 portal or email to billing support.
 *
 * If/when Pax8 ships a real endpoint, the local-storage path can be replaced
 * with `ctx.api.invoices.dispute(...)` without changing the CLI surface.
 */

const DISPUTES_DIR_ENV = "PAX8_DISPUTES_DIR";

function disputesDir(): string {
  // #458: route through getConfigDir() so PAX8_CONFIG_DIR is honored.
  // PAX8_DISPUTES_DIR retains precedence as the explicit per-feature
  // escape hatch used in tests.
  return process.env[DISPUTES_DIR_ENV] ?? path.join(getConfigDir(), "disputes");
}

/**
 * Compute a stable discrepancy ID from the audit fields so `pax8 invoices audit`
 * and `pax8 invoices dispute --discrepancy <id>` speak the same language.
 */
export function discrepancyId(parts: {
  companyId: string;
  productName: string;
  type: string;
  month?: string;
}): string {
  const key = `${parts.companyId}|${parts.productName}|${parts.type}|${parts.month ?? ""}`;
  return "disc-" + createHash("sha1").update(key).digest("hex").slice(0, 12);
}

interface DisputeDraft {
  id: string;
  discrepancyId: string;
  status: "draft";
  createdAt: string;
  month?: string;
  companyId: string;
  companyName: string;
  productName: string;
  type: "overcharge" | "undercharge" | "missing" | "unexpected";
  invoicedQuantity: number;
  activeQuantity: number;
  delta: number;
  dollarImpact: number;
  reason?: string;
  portalTemplate: string;
}

function buildPortalTemplate(d: Omit<DisputeDraft, "id" | "portalTemplate" | "status" | "createdAt">): string {
  const sign = d.delta > 0 ? "+" : "";
  const impactLabel =
    d.dollarImpact > 0
      ? `${formatCurrency(d.dollarImpact)} overcharge`
      : `${formatCurrency(Math.abs(d.dollarImpact))} undercharge`;
  const period = d.month ? d.month : "current period";
  const lines = [
    `Subject: Billing discrepancy — ${d.companyName} — ${d.productName} (${period})`,
    "",
    `Hi Pax8 billing team,`,
    "",
    `I'd like to dispute a billing discrepancy detected by automated reconciliation.`,
    "",
    `  Company:           ${d.companyName} (${d.companyId})`,
    `  Product:           ${d.productName}`,
    `  Period:            ${period}`,
    `  Discrepancy type:  ${d.type}`,
    `  Invoiced quantity: ${d.invoicedQuantity}`,
    `  Active quantity:   ${d.activeQuantity}`,
    `  Delta:             ${sign}${d.delta} seat(s)`,
    `  Impact:            ${impactLabel}`,
    `  Discrepancy ID:    ${d.discrepancyId}`,
    "",
  ];
  if (d.reason) {
    lines.push(`Notes from partner:`);
    lines.push(`  ${d.reason}`);
    lines.push("");
  }
  lines.push(`Please review and adjust the invoice or issue a credit memo.`);
  lines.push("");
  lines.push(`— Filed via pax8-cli`);
  return lines.join("\n");
}

async function writeDraft(draft: DisputeDraft): Promise<string> {
  const dir = disputesDir();
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, `${draft.id}.json`);
  const tmp = fp + ".tmp";
  // #458: write via safeWriteFileSync so the tmp file is created with
  // mode 0o600 atomically (no chmod race) and a symlink at the tmp path
  // can't redirect the write.
  safeWriteFileSync(tmp, JSON.stringify(draft, null, 2));
  await fs.rename(tmp, fp);
  return fp;
}

interface DiscrepancyShape {
  companyId: string;
  companyName: string;
  productName: string;
  type: "overcharge" | "undercharge" | "missing" | "unexpected";
  invoicedQuantity: number;
  activeQuantity: number;
  delta: number;
  dollarImpact: number;
}

async function findDiscrepancy(
  opts: { discrepancy?: string; company?: string; product?: string; month?: string },
  ctx: Awaited<ReturnType<typeof buildContext>>,
): Promise<DiscrepancyShape> {
  // Audit the relevant slice
  const companyId = opts.company ? await resolveCompanyId(ctx, opts.company) : undefined;
  const [invoicesResult, subsResult] = await Promise.all([
    ctx.api.invoices.list({ month: opts.month, companyId, size: 200 }),
    ctx.api.subscriptions.list({ companyId, size: ALL_SUBS_PAGE_SIZE }),
  ]);
  const allItems = (
    await Promise.all(
      invoicesResult.content.map((inv) =>
        ctx.api.invoices.listItems(inv.id, { size: 500 }).catch(() => ({ content: [] })),
      ),
    )
  ).flatMap((r) => r.content);

  const normalizedSubs = subsResult.content.map((s) => {
    const { id: _id, ...rest } = s;
    return { ...rest, subscriptionId: undefined, unitPrice: s.price };
  });
  const report = auditInvoices(allItems, normalizedSubs);

  if (report.discrepancies.length === 0) {
    throw new CliError(
      "No discrepancies found to dispute.",
      ["The audit returned a clean bill of health for the requested scope."],
      [`Run ${replCmd("pax8 invoices audit")} to refresh.`],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }

  // Match by discrepancy ID first
  if (opts.discrepancy) {
    const target = report.discrepancies.find(
      (d) => discrepancyId({ companyId: d.companyId, productName: d.productName, type: d.type, month: opts.month }) === opts.discrepancy,
    );
    if (!target) {
      throw new CliError(
        `No discrepancy matches ID "${opts.discrepancy}"`,
        ["The discrepancy ID couldn't be located in the current audit."],
        [
          `Re-run ${replCmd("pax8 invoices audit --json")} to get fresh discrepancy IDs.`,
          `Or pass --company and --product instead.`,
        ],
        undefined,
        ERROR_INVALID_INPUT,
      );
    }
    return target;
  }

  // Match by company + product
  if (opts.product) {
    const wanted = opts.product.toLowerCase();
    const matches = report.discrepancies.filter((d) =>
      d.productName.toLowerCase().includes(wanted),
    );
    if (matches.length === 0) {
      throw new CliError(
        `No discrepancy for product "${opts.product}"${opts.company ? ` at ${opts.company}` : ""}.`,
        undefined,
        [`Run ${replCmd("pax8 invoices audit")} to see what's open.`],
        undefined,
        ERROR_INVALID_INPUT,
      );
    }
    if (matches.length > 1) {
      throw new CliError(
        `Multiple discrepancies match "${opts.product}".`,
        matches.slice(0, 5).map((m) => `${m.companyName} — ${m.productName} (${m.type})`),
        [`Pass --discrepancy <id> from ${replCmd("pax8 invoices audit --json")} to disambiguate.`],
        undefined,
        ERROR_INVALID_INPUT,
      );
    }
    return matches[0];
  }

  // Last resort: if exactly one discrepancy in scope, use it
  if (report.discrepancies.length === 1) return report.discrepancies[0];

  throw new CliError(
    "Ambiguous dispute target.",
    [`The audit returned ${report.discrepancies.length} discrepancies.`],
    [
      `Pass --discrepancy <id> from ${replCmd("pax8 invoices audit --json")},`,
      `or narrow with --company and --product.`,
    ],
    undefined,
    ERROR_INVALID_INPUT,
  );
}

export const invoicesDisputeCommand = new Command("dispute")
  .description("File a dispute draft for an invoice discrepancy surfaced by 'pax8 invoices audit'")
  .option("--discrepancy <id>", "Discrepancy ID from `pax8 invoices audit --json`")
  .option("--company <id|name>", "Company filter — required if --discrepancy isn't given")
  .option("--product <name>", "Product name (substring) — narrows when multiple match")
  .option("--month <YYYY-MM>", "Period the discrepancy applies to")
  .option("--reason <text>", "Free-form note included in the support template")
  .option("-y, --yes", "Skip the confirmation prompt")
  .option(
    "--idempotency-key <uuid>",
    "Host-local replay cache key (24h TTL). Same-host re-runs return the cached draft. Cross-host / cross-process retries are NOT deduped — see #474. Accepts UUIDs or 8–128 char identifiers (letters, digits, '-', '_', '.')",
  )
  .addHelpText(
    "after",
    `
Closed loop with 'pax8 invoices audit':
  audit identifies the discrepancy → dispute records the draft and renders a
  portal-ready support template. Drafts are stored under the CLI config
  directory (see PAX8_CONFIG_DIR; defaults to ~/.pax8/disputes/), or
  PAX8_DISPUTES_DIR if set explicitly.

Examples:
  pax8 invoices audit                                              # find discrepancies first
  pax8 invoices dispute --company "Summit Healthcare" --product "Microsoft 365"
  pax8 invoices dispute --discrepancy disc-a1b2c3d4e5f6 --reason "Customer downgraded mid-cycle"
  pax8 invoices dispute --company "Summit Healthcare" --product "M365" --yes
  pax8 invoices dispute --discrepancy disc-a1b2c3d4e5f6 --json

Note: The Pax8 v1 API does not expose a public dispute endpoint, so this
command files a local draft and produces a support ticket template you can
paste into the Pax8 portal. Same-host re-runs with --idempotency-key
return the cached draft (host-local; see #474 for v0.2 wire-level plan).`,
  )
  .action(async (_options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    // ── Idempotency handling ────────────────────────────────────────────────
    const idempotencyKey: string | undefined = allOpts.idempotencyKey;
    if (idempotencyKey !== undefined && !isValidKey(idempotencyKey)) {
      await handleCommandError(
        new CliError(
          `Invalid idempotency key: "${idempotencyKey}"`,
          [
            "Idempotency keys must be 8–128 characters of letters, digits, '-', '_', or '.'",
            "UUID v4 is recommended.",
          ],
          [
            "Generate one with: uuidgen",
            `Example: ${replCmd("pax8 invoices dispute")} ... --idempotency-key 9f3b2c1e-7d4f-4a8b-9c2d-1e2f3a4b5c6d`,
          ],
          undefined,
          ERROR_INVALID_INPUT satisfies Pax8ErrorCode,
        ),
      );
    }
    const argsHash = hashArgs({
      discrepancy: allOpts.discrepancy,
      company: allOpts.company,
      product: allOpts.product,
      month: allOpts.month,
      reason: allOpts.reason,
    });

    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Locating discrepancy...");

    try {
      await withIdempotency<boolean>(
        {
          commandName: "invoices.dispute",
          idempotencyKey,
          argsHash,
          // Don't cache "user cancelled at confirm" as a successful run.
          shouldPersist: (didWrite) => didWrite,
        },
        async (): Promise<boolean> => {
      // Validate that we have something to look up
      if (!allOpts.discrepancy && !allOpts.company) {
        throw new CliError(
          "Provide --discrepancy <id> or --company <name>.",
          ["Without one of these flags there's no way to identify the discrepancy to dispute."],
          [
            `Run ${replCmd("pax8 invoices audit --json")} and pass the discrepancy ID.`,
            `Or: ${replCmd("pax8 invoices dispute")} --company "Acme Corp" --product "M365"`,
          ],
          undefined,
          ERROR_INVALID_INPUT satisfies Pax8ErrorCode,
        );
      }

      spinner.start();
      const target = await findDiscrepancy(allOpts, ctx);
      spinner.stop();

      const month: string | undefined = allOpts.month;
      const discId = discrepancyId({
        companyId: target.companyId,
        productName: target.productName,
        type: target.type,
        month,
      });

      const draftBase = {
        discrepancyId: discId,
        month,
        companyId: target.companyId,
        companyName: target.companyName,
        productName: target.productName,
        type: target.type,
        invoicedQuantity: target.invoicedQuantity,
        activeQuantity: target.activeQuantity,
        delta: target.delta,
        dollarImpact: target.dollarImpact,
        reason: allOpts.reason,
      };
      const portalTemplate = buildPortalTemplate(draftBase);

      // ── Preview ──────────────────────────────────────────────────────────
      const sign = target.delta > 0 ? "+" : "";
      const impactLabel =
        target.dollarImpact > 0
          ? `${formatCurrency(target.dollarImpact)} overcharge`
          : `${formatCurrency(Math.abs(target.dollarImpact))} undercharge`;

      if (ctx.outputFormat !== "json" && ctx.outputFormat !== "quiet") {
        process.stderr.write(chalk.bold("\n  📝 Dispute Draft:\n\n"));
        process.stderr.write(`  ${chalk.dim("Company:".padEnd(18))}${target.companyName}\n`);
        process.stderr.write(`  ${chalk.dim("Product:".padEnd(18))}${target.productName}\n`);
        if (month) process.stderr.write(`  ${chalk.dim("Period:".padEnd(18))}${month}\n`);
        process.stderr.write(`  ${chalk.dim("Type:".padEnd(18))}${target.type}\n`);
        process.stderr.write(`  ${chalk.dim("Invoiced:".padEnd(18))}${formatQuantity(target.invoicedQuantity)}\n`);
        process.stderr.write(`  ${chalk.dim("Active:".padEnd(18))}${formatQuantity(target.activeQuantity)}\n`);
        process.stderr.write(`  ${chalk.dim("Delta:".padEnd(18))}${sign}${target.delta}\n`);
        process.stderr.write(`  ${chalk.dim("Impact:".padEnd(18))}${chalk.yellow(impactLabel)}\n`);
        if (allOpts.reason) {
          process.stderr.write(`  ${chalk.dim("Note:".padEnd(18))}${allOpts.reason}\n`);
        }
        process.stderr.write(`  ${chalk.dim("Discrepancy ID:".padEnd(18))}${discId}\n\n`);
      }

      const ok = await confirm("File this dispute draft?", { default: true });
      if (!ok) {
        if (ctx.outputFormat !== "json" && ctx.outputFormat !== "quiet") {
          process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        }
        return false;
      }

      // ── Persist the draft (the "write" half of the closed loop) ─────────
      const id = "disp-" + randomUUID().slice(0, 8);
      const draft: DisputeDraft = {
        id,
        status: "draft",
        createdAt: new Date().toISOString(),
        portalTemplate,
        ...draftBase,
      };

      const writeSpinner = createSpinner("Filing dispute...").start();
      const done = markWriteInFlight("invoices", undefined, idempotencyKey);
      let filePath: string;
      try {
        filePath = await writeDraft(draft);
      } finally {
        done();
      }
      writeSpinner.succeed("Dispute draft filed");

      // ── Output ───────────────────────────────────────────────────────────
      if (ctx.outputFormat === "json") {
        const enriched = {
          ...draft,
          filePath,
          nextActions: [
            {
              command: `cat "${filePath}"`,
              description: "View the full dispute draft (incl. portal template)",
            },
            {
              command: `pax8 invoices audit --month ${month ?? new Date().toISOString().slice(0, 7)} --json`,
              description: "Re-audit to confirm the discrepancy is still open",
            },
          ],
        };
        process.stdout.write(JSON.stringify(enriched, null, 2) + "\n");
        return true;
      }

      if (ctx.outputFormat === "quiet") {
        return true;
      }

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("Draft ID:".padEnd(18))}${draft.id}\n`);
      process.stdout.write(`  ${chalk.dim("Saved to:".padEnd(18))}${filePath}\n`);
      process.stdout.write("\n");
      process.stdout.write(chalk.dim("  ── Portal-ready support ticket ──\n"));
      for (const line of portalTemplate.split("\n")) {
        process.stdout.write(`  ${line}\n`);
      }
      process.stdout.write("\n");
      process.stderr.write(chalk.dim("  Next steps:\n"));
      process.stderr.write(`    ${chalk.cyan(`Paste the template above into the Pax8 portal billing support form.`)}\n`);
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 invoices audit`))} ${chalk.dim("re-audit later to confirm resolution")}\n\n`);

          return true;
        },
      );
    } catch (error) {
      // withIdempotency restores stdout via try/finally before bubbling here.
      if (error instanceof CliError) {
        await handleCommandError(error, spinner);
      }
      await handleCommandError(
        error instanceof Error
          ? new CliError(
              `Failed to file dispute: ${error.message}`,
              undefined,
              undefined,
              undefined,
              ERROR_INTERNAL satisfies Pax8ErrorCode,
            )
          : error,
        spinner,
      );
    }
  });
