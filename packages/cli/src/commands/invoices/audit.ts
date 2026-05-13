// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext, warnIfTruncated } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatQuantity } from "../../lib/formatters.js";
import { ALL_SUBS_PAGE_SIZE, auditInvoices } from "@pax8/core";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { discrepancyId } from "./dispute.js";
import { replCmd } from "../../lib/confirm.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";

export const invoicesAuditCommand = new Command("audit")
  .description("Audit invoices against active subscriptions")
  .option("--month <YYYY-MM>", "Filter by month (YYYY-MM)")
  .option("--company <id|name>", "Filter by company ID or name")
  .addHelpText(
    "after",
    `
Examples:
  pax8 invoices audit
  pax8 invoices audit --month 2026-03
  pax8 invoices audit --company "Summit Healthcare"
  pax8 invoices audit --json

Note: this audit compares the partner's invoiced charges against their
current active subscriptions (a partner-side reconciliation). It is not
the same as Pax8's internal vendor reconciliation, which compares
vendor-billed amounts against Pax8's records (vendor-side).

JSON output (--json):
  Returns a single-element array (legacy shape) wrapping the audit report:

  [{
    "discrepancies": [{
      "companyId": string,
      "companyName": string,
      "productName": string,
      "invoicedQuantity": number,
      "activeQuantity": number,
      "delta": number,                    // invoicedQuantity − activeQuantity
      "dollarImpact": number,             // positive = overcharge, negative = undercharge
      "type": "overcharge" | "undercharge" | "unexpected",
      "discrepancyId": string             // stable id — pass to "pax8 invoices dispute --discrepancy <id>"
    }],
    "totalOvercharge": number,
    "totalUndercharge": number,
    "netImpact": number,
    "nextActions": [{ "command": string, "description": string }]
  }]`
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching invoices...");

    try {
      spinner.start();

      const companyId = options.company
        ? await resolveCompanyId(ctx, options.company)
        : undefined;

      // Fetch invoices and active subscriptions in parallel
      const [invoicesResult, subsResult] = await Promise.all([
        ctx.api.invoices.list({ month: options.month, companyId, size: 200 }),
        ctx.api.subscriptions.list({ companyId, size: ALL_SUBS_PAGE_SIZE }),
      ]);

      warnIfTruncated(subsResult, ALL_SUBS_PAGE_SIZE);

      // Fetch items for each invoice in parallel
      const allItems = (
        await Promise.all(
          invoicesResult.content.map((inv) =>
            ctx.api.invoices.listItems(inv.id, { size: 500 }).catch(() => ({ content: [] }))
          )
        )
      ).flatMap((r) => r.content);

      spinner.stop();

      // If no invoices/items, short circuit
      if (allItems.length === 0) {
        if (ctx.outputFormat === "json") {
          output([{ discrepancies: [], totalOvercharge: 0, totalUndercharge: 0, netImpact: 0 }], { format: "json" });
        } else if (ctx.outputFormat !== "quiet") {
          const monthLabel = options.month ? formatMonthLabel(options.month) : "current";
          process.stdout.write(`\n  ${chalk.green("✓")} No invoices found for ${monthLabel} period.\n\n`);
        }
        return;
      }

      const itemsResult = { content: allItems };

      // Normalize subscriptions for audit matching:
      // The auditor matches on subscriptionId first, falling back to companyId+productId.
      // Invoice items don't have subscriptionId, so we map subscriptions to use
      // companyId+productId matching by omitting the id field and setting subscriptionId undefined.
      const normalizedSubs = subsResult.content.map((s) => {
        const { id, ...rest } = s;
        return {
          ...rest,
          subscriptionId: undefined,
          unitPrice: s.price,
        };
      });

      // Run audit
      const report = auditInvoices(itemsResult.content, normalizedSubs);

      // Stamp each discrepancy with a stable ID so `pax8 invoices dispute
      // --discrepancy <id>` can locate it without re-auditing under the user's
      // exact filters.
      const stampedDiscrepancies = report.discrepancies.map((d) => ({
        ...d,
        discrepancyId: discrepancyId({
          companyId: d.companyId,
          productName: d.productName,
          type: d.type,
          month: options.month,
        }),
      }));

      // JSON output
      if (ctx.outputFormat === "json") {
        const nextActions = stampedDiscrepancies
          .slice(0, 5)
          .map((d) => ({
            command: `pax8 invoices dispute --discrepancy ${d.discrepancyId}${options.month ? ` --month ${options.month}` : ""}`,
            description: `File a dispute for ${d.companyName} — ${d.productName} (${d.type}, Δ${d.delta > 0 ? "+" : ""}${d.delta})`,
          }));
        output(
          [{ ...report, discrepancies: stampedDiscrepancies, nextActions }],
          { format: "json" },
        );
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      // CSV output
      if (ctx.outputFormat === "csv") {
        const columns = [
          { key: "companyName", header: "Company" },
          { key: "productName", header: "Product" },
          { key: "invoicedQuantity", header: "Invoiced Qty" },
          { key: "activeQuantity", header: "Active Qty" },
          { key: "delta", header: "Delta" },
          { key: "dollarImpact", header: "Dollar Impact" },
          { key: "type", header: "Type" },
        ];
        output(report.discrepancies, { format: "csv", columns });
        return;
      }

      // Human-readable audit report
      const monthLabel = options.month
        ? formatMonthLabel(options.month)
        : "current";

      if (report.discrepancies.length === 0) {
        process.stdout.write(
          `\n  ${chalk.green("✓")} No discrepancies found in ${monthLabel} invoices.\n\n`
        );
        return;
      }

      process.stdout.write(
        `\n  ${chalk.yellow("⚠")} ${report.discrepancies.length} discrepancies found in ${monthLabel} invoices:\n\n`
      );

      // Prefix each discrepancy with `N.` so the partner can read the
      // pickable list below as a direct reference into this output (e.g.
      // "type 3 to dispute discrepancy #3"). Keeps the existing single-id
      // form in the `[…]` brackets so partners who copy-paste the id by
      // hand can still locate it.
      stampedDiscrepancies.forEach((d, i) => {
        const idx = i + 1;
        process.stdout.write(
          `  ${chalk.bold(`${idx}.`)} ${chalk.bold(d.companyName)} — ${d.productName}  ${chalk.dim(`[${d.discrepancyId}]`)}\n`
        );

        const deltaSign = d.delta > 0 ? "+" : "";
        const impactLabel =
          d.dollarImpact > 0
            ? `${formatCurrency(d.dollarImpact)} overcharge`
            : `${formatCurrency(Math.abs(d.dollarImpact))} undercharge`;

        process.stdout.write(
          `     Invoiced: ${formatQuantity(d.invoicedQuantity)}    Active: ${formatQuantity(d.activeQuantity)}    Δ ${deltaSign}${d.delta} (${impactLabel})\n`
        );
        process.stdout.write("\n");
      });

      // Footer with totals
      process.stdout.write(chalk.dim("  ─────────────────────────────\n"));
      if (report.totalOvercharge > 0) {
        process.stdout.write(
          `  ${chalk.red("Overcharges:")}  ${formatCurrency(report.totalOvercharge)}\n`
        );
      }
      if (report.totalUndercharge > 0) {
        process.stdout.write(
          `  ${chalk.yellow("Undercharges:")} ${formatCurrency(report.totalUndercharge)}\n`
        );
      }
      process.stdout.write(
        `  ${chalk.bold("Net impact:")}   ${formatCurrency(report.netImpact)}\n`
      );
      process.stdout.write("\n");

      // Closed-loop hint: every discrepancy becomes a pickable dispute
      // entry. Partners can scan the indexed list above, type a number, and
      // the dispute is drafted with the discrepancy id (and month, when
      // filtering by month) carried through automatically.
      if (stampedDiscrepancies.length > 0) {
        const monthArgs = options.month ? ["--month", options.month] : [];
        const steps: NextStep[] = stampedDiscrepancies.map((d, i) => {
          const command = ["invoices", "dispute", "--discrepancy", d.discrepancyId, ...monthArgs];
          return {
            key: String(i + 1),
            label: `${chalk.cyan(replCmd(`pax8 invoices dispute --discrepancy ${d.discrepancyId}`))}  ${chalk.dim(`${d.companyName} — ${d.productName}`)}`,
            command,
          };
        });
        process.stderr.write(chalk.dim("  Try next:\n"));
        await promptNextSteps(steps, { renderList: true });
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to audit invoices");
    }
  });

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  const date = new Date(parseInt(year), parseInt(m) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
