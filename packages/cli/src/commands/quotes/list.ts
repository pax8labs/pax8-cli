// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import {
  output,
  type Column,
  buildPageEnvelope,
  renderPaginationFooter,
  renderReplNavHint,
} from "../../lib/output.js";
import { saveLastListContext } from "../../lib/last-list.js";
import { wireListDrillIn } from "../../lib/list-drill-in.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatDate, formatCurrency } from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { replCmd } from "../../lib/confirm.js";
import { clampListSize, LIST_SIZE_CAP, validateEnum, warnSizeClamped } from "../../lib/validate.js";
import type { Quote } from "@pax8/core";

// Lowercase enum from `quoting-endpoints.json` → `GET /v2/quotes`. The
// wire is case-sensitive, but we accept any casing from the CLI and
// canonicalize via `validateEnum({ lowercase: true })` so the partner
// can type `Sent` / `SENT` / `sent` interchangeably.
const QUOTE_STATUS_VALUES = [
  "draft",
  "assigned",
  "sent",
  "closed",
  "declined",
  "accepted",
  "changes_requested",
  "expired",
  "pending",
] as const;

function quoteTotal(q: Quote): number {
  if (!q.lineItems) return 0;
  return q.lineItems.reduce((s, li) => s + (li.subtotal ?? (li.unitPrice ?? 0) * li.quantity), 0);
}

export const quotesListCommand = new Command("list")
  .description("List sales quotes")
  .option("--company <id|name>", "Filter by company ID or name")
  .option(
    "--status <status>",
    // Lowercase enum from `quoting-endpoints.json` → `GET /v2/quotes`. The
    // CLI previously filtered client-side (#387) because the API client
    // hid this parameter; now it threads straight to the wire.
    "Filter by status (draft, assigned, sent, closed, declined, accepted, changes_requested, expired, pending)"
  )
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", `Page size (max ${LIST_SIZE_CAP}; larger values are clamped)`, "50")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 quotes list
  pax8 quotes list --company "Summit Healthcare Partners"
  pax8 quotes list --status Sent
  pax8 quotes list --json
  pax8 quotes list --csv
  pax8 quotes list --ids-only | xargs -I{} pax8 quotes show {}`
  )
  .action(async (options, command) => {
    const allOpts = command.optsWithGlobals();
    // Fail-fast on typo'd `--status` BEFORE any network call (#408).
    // Accepts mixed casing because the CLI normalizes before sending; an
    // unknown value still raises a helpful "Allowed:" list rather than
    // silently round-tripping as `?status=foobar` and returning `[]`.
    let status: string | undefined;
    try {
      status = validateEnum(
        allOpts.status,
        QUOTE_STATUS_VALUES,
        "--status",
        { lowercase: true, cmdHint: "pax8 quotes list" },
      );
    } catch (error) {
      await handleCommandError(error);
    }
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching quotes...");

    try {
      spinner.start();
      const companyId = allOpts.company
        ? await resolveCompanyId(ctx, allOpts.company)
        : undefined;
      const apiPage = Math.max(parseInt(allOpts.page, 10) - 1, 0);
      // #518: clamp `--size` at LIST_SIZE_CAP (1000).
      const sizeResult = clampListSize(parseInt(allOpts.size, 10), 50);
      if (sizeResult.clamped) {
        warnSizeClamped(sizeResult.requested, LIST_SIZE_CAP, { quiet: allOpts.quiet });
      }
      const result = await ctx.api.quotes.list({
        companyId,
        status,
        page: apiPage,
        size: sizeResult.size,
      });
      spinner.stop();

      const quotes = result.content;

      if (allOpts.idsOnly) {
        for (const item of quotes) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      // #483: build the 1-based page envelope once for both JSON and footer.
      const pageEnvelope = buildPageEnvelope(result.page);
      // #418: row numbers continue across pages.
      const startNum = result.page.number * result.page.size;
      const enriched = quotes.map((q, i) => ({
        ...q,
        _num: String(startNum + i + 1),
        _total: quoteTotal(q),
        _items: q.lineItems?.length ?? 0,
      }));
      const filterFlag = [
        allOpts.company ? `--company "${allOpts.company}"` : "",
        status ? `--status ${status}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const nextPageCommand =
        `pax8 quotes list --page ${pageEnvelope.number + 1} --size ${pageEnvelope.size}` +
        (filterFlag ? ` ${filterFlag}` : "");

      if (ctx.outputFormat === "json") {
        process.stdout.write(
          JSON.stringify({ quotes: enriched, page: pageEnvelope }, null, 2) + "\n",
        );
        return;
      }

      // #385: timestamp columns reference the canonical `createdAt` /
      // `expiresAt`. The legacy `createdOn` / `expiresOn` aliases are still
      // emitted on every row in `--json` output for backwards compatibility;
      // removal in v0.3.0.
      // #418: leading `_num` column makes rows pickable by number in the REPL.
      const columns: Column[] = [
        { key: "_num", header: "#" },
        { key: "id", header: "ID", width: 14, format: (v) => chalk.dim(String(v).slice(0, 12)) },
        { key: "companyId", header: "Company ID", width: 14, format: (v) => chalk.dim(String(v).slice(0, 12)) },
        { key: "status", header: "Status", width: 12 },
        { key: "createdAt", header: "Created", width: 14, format: (v) => formatDate(String(v)) },
        { key: "expiresAt", header: "Expires", width: 14, format: (v) => v ? formatDate(String(v)) : "—" },
        { key: "_items", header: "Items", width: 7 },
        { key: "_total", header: "Total", width: 12, format: (v) => formatCurrency(Number(v)) },
      ];

      const filtersApplied: Record<string, string> = {};
      if (allOpts.company) filtersApplied.company = `"${allOpts.company}"`;
      if (status) filtersApplied.status = String(status);
      const emptyReasons: string[] = [];
      if (Object.keys(filtersApplied).length === 0) {
        emptyReasons.push("This tenant has no quotes yet.");
      }

      output(enriched, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: "No quotes found.",
          filtersApplied: Object.keys(filtersApplied).length > 0 ? filtersApplied : undefined,
          reasons: emptyReasons.length > 0 ? emptyReasons : undefined,
          suggestions: [
            {
              command: "pax8 quotes list",
              description: "list all quotes (no filters)",
            },
            {
              command: replCmd("pax8 quotes create --company <id|name>"),
              description: "draft your first quote",
            },
          ],
        },
      });

      if (ctx.outputFormat === "table" && enriched.length > 0) {
        const total = enriched.reduce((s, q) => s + q._total, 0);
        renderPaginationFooter(pageEnvelope, {
          resourceSingular: "quote",
          nextPageCommand,
          rowCount: enriched.length,
        });
        renderReplNavHint(pageEnvelope);
        const userArgv = process.argv.slice(2);
        const first0 = userArgv[0];
        if (userArgv.length > 0 && first0 !== "back" && first0 !== "n" && first0 !== "p") {
          await saveLastListContext({
            command: userArgv,
            page: {
              number: pageEnvelope.number,
              totalPages: pageEnvelope.totalPages,
            },
          });
        }
        process.stderr.write(
          chalk.dim(`  Total on this page: ${formatCurrency(total)}\n`),
        );
        // #418: pickable drill-in supersedes the previous hard-coded
        // `Try next: pax8 quotes show <first>` hint. The drill-in
        // helper handles the prompt; the static hint stays for users
        // who already know the canonical command.
        const first = enriched[0];
        process.stderr.write(chalk.dim("\n  Or: ") + chalk.cyan(replCmd(`pax8 quotes show ${first.id}`)) + chalk.dim(" — view quote details\n\n"));
        await wireListDrillIn({
          rows: quotes,
          resource: "quotes",
          startNum,
          getLabel: (q) => {
            // Quote schema doesn't carry a user-facing title field — use
            // the `referenceCode` (e.g. "Q-2026-002") when present, fall
            // back to the truncated id.
            const code = (q as { referenceCode?: string }).referenceCode;
            return code ?? `Quote ${String(q.id).slice(0, 8)}`;
          },
        });
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list quotes");
    }
  });
