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
  buildNextPageAction,
  renderReplNavHint,
} from "../../lib/output.js";
import { saveLastListContext } from "../../lib/last-list.js";
import { wireListDrillIn } from "../../lib/list-drill-in.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatDate, formatStatus } from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { clampListSize, LIST_SIZE_CAP, validateEnum, warnSizeClamped } from "../../lib/validate.js";

// Help text mirrors the public OpenAPI enum for `GET /invoices`'s
// `status` query parameter (#250). The wire emits a narrower 4-value
// set (`InvoiceStatusSchema`); the query side documents 6 acceptable
// inputs. Per #408 we now fail-fast on a typo'd value rather than
// passing it through and returning `[]`.
const INVOICE_STATUS_VALUES = [
  "Unpaid",
  "Paid",
  "Void",
  "Carried",
  "Nothing Due",
  "Credited",
] as const;

// #389: --sort accepts the spec's camelCase field names plus kebab-cased CLI
// aliases for ergonomics. Keep this map locked to the OpenAPI sort enum:
// invoiceDate | dueDate | status | partnerName | total | balance |
// carriedBalance.
const INVOICE_SORT_ALIASES: Record<
  string,
  "invoiceDate" | "dueDate" | "status" | "partnerName" | "total" | "balance" | "carriedBalance"
> = {
  "invoice-date": "invoiceDate",
  invoicedate: "invoiceDate",
  date: "invoiceDate",
  "due-date": "dueDate",
  duedate: "dueDate",
  status: "status",
  "partner-name": "partnerName",
  partnername: "partnerName",
  partner: "partnerName",
  total: "total",
  balance: "balance",
  "carried-balance": "carriedBalance",
  carriedbalance: "carriedBalance",
  carried: "carriedBalance",
};

export const invoicesListCommand = new Command("list")
  .description("List invoices")
  .option("--month <YYYY-MM>", "Filter by month (YYYY-MM)")
  .option("--company <id|name>", "Filter by company ID or name")
  // Help text mirrors the full public OpenAPI enum for `GET /invoices`'s
  // `status` query parameter (#250). Previously the help listed only 4 of the
  // 6 documented values (`Nothing Due` and `Credited` were missing).
  // The multi-word "Nothing Due" passes through to the wire as-is.
  .option(
    "--status <status>",
    'Filter by status (Unpaid, Paid, Void, Carried, "Nothing Due", Credited)'
  )
  // ─── Date range filters (#389) ──────────────────────────────────────────
  // Ergonomic aliases mapping to the spec's `invoiceDateRangeStart` /
  // `invoiceDateRangeEnd`. `--from` / `--to` are the human-friendly names
  // partners reach for first.
  .option("--from <YYYY-MM-DD>", "Start of invoice-date range (maps to invoiceDateRangeStart)")
  .option("--to <YYYY-MM-DD>", "End of invoice-date range (maps to invoiceDateRangeEnd)")
  // ─── Sort (#389) ────────────────────────────────────────────────────────
  .option(
    "--sort <field>",
    "Sort by field (invoice-date, due-date, status, partner-name, total, balance, carried-balance)"
  )
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", `Page size (max ${LIST_SIZE_CAP}; larger values are clamped)`, "25")
  .option("--ids-only", "Output only resource IDs, one per line")
  .option("--with-actions", "Wrap JSON output as { invoices, nextActions } instead of a flat array")
  .addHelpText(
    "after",
    `
Examples:
  pax8 invoices list
  pax8 invoices list --month 2026-03
  pax8 invoices list --from 2026-01-01 --to 2026-03-31
  pax8 invoices list --company "Summit Healthcare"
  pax8 invoices list --status Unpaid
  pax8 invoices list --status "Nothing Due"
  pax8 invoices list --sort due-date
  pax8 invoices list --json
  pax8 invoices list --json --with-actions
  pax8 invoices list --csv
  pax8 invoices list --ids-only | xargs -I{} pax8 invoices show {}`
  )
  .action(async (options, command) => {
    const allOpts = command.optsWithGlobals();
    // Fail-fast on typo'd `--status` BEFORE buildContext / any network call
    // (#408 / partner-walkthrough finding #2). Previously `--status FooBar`
    // hit the API as a no-op filter and returned `[]`, so partners debugged
    // an empty-result mystery instead of fixing a typo.
    try {
      validateEnum(allOpts.status, INVOICE_STATUS_VALUES, "--status", {
        cmdHint: "pax8 invoices list",
      });
    } catch (error) {
      await handleCommandError(error);
    }
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching invoices...");

    try {
      spinner.start();
      const companyId = allOpts.company
        ? await resolveCompanyId(ctx, allOpts.company)
        : undefined;
      const apiPage = Math.max(parseInt(allOpts.page, 10) - 1, 0);
      // #389: map ergonomic CLI flags (`--from` / `--to`, `--sort` in kebab-
      // case) onto the spec-canonical query-parameter names.
      const sortRaw = allOpts.sort ? String(allOpts.sort).toLowerCase() : undefined;
      const sort = sortRaw ? INVOICE_SORT_ALIASES[sortRaw] : undefined;
      // #518: clamp `--size` at LIST_SIZE_CAP (1000) to keep `jq`
      // pipelines and agent contexts from getting blown out by an
      // unbounded request.
      const sizeResult = clampListSize(parseInt(allOpts.size, 10), 25);
      if (sizeResult.clamped) {
        warnSizeClamped(sizeResult.requested, LIST_SIZE_CAP, { quiet: allOpts.quiet });
      }
      const result = await ctx.api.invoices.list({
        month: allOpts.month,
        companyId,
        status: allOpts.status,
        invoiceDateRangeStart: allOpts.from,
        invoiceDateRangeEnd: allOpts.to,
        sort,
        page: apiPage,
        size: sizeResult.size,
      });
      spinner.stop();

      if (allOpts.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      // #418: leading `_num` column makes rows pickable by number in the REPL.
      const columns: Column[] = [
        { key: "_num", header: "#" },
        {
          key: "id",
          header: "ID",
          width: 12,
          format: (v) => String(v).slice(0, 8),
        },
        { key: "companyName", header: "Company", width: 22 },
        {
          key: "invoiceDate",
          header: "Date",
          width: 14,
          format: (v) => formatDate(String(v)),
        },
        {
          key: "dueDate",
          header: "Due Date",
          width: 14,
          format: (v) => formatDate(String(v)),
        },
        {
          key: "status",
          header: "Status",
          width: 14,
          format: (v) => formatStatus(String(v)),
        },
        {
          key: "total",
          header: "Total",
          width: 14,
          format: (v) => formatCurrency(Number(v)),
        },
      ];

      // #483: build the page envelope once for both JSON and footer.
      const pageEnvelope = buildPageEnvelope(result.page);
      // #418: row numbers continue across pages.
      const startNum = result.page.number * result.page.size;
      const numbered = result.content.map((row, i) => ({
        ...row,
        _num: String(startNum + i + 1),
      }));
      const filterFlag = [
        allOpts.company ? `--company "${allOpts.company}"` : "",
        allOpts.status ? `--status "${allOpts.status}"` : "",
        allOpts.month ? `--month ${allOpts.month}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const nextPageCommand =
        `pax8 invoices list --page ${pageEnvelope.number + 1} --size ${pageEnvelope.size}` +
        (filterFlag ? ` ${filterFlag}` : "");

      if (ctx.outputFormat === "json") {
        const invoices = result.content;
        if (options.withActions) {
          const nextActions: { command: string; description: string }[] = [];
          const pageAction = buildNextPageAction(
            pageEnvelope,
            `${nextPageCommand} --json`,
            "invoice",
          );
          if (pageAction) nextActions.push(pageAction);
          const unpaid = invoices.filter(
            (inv) =>
              String((inv as Record<string, unknown>).status ?? "").toLowerCase() === "unpaid"
          );
          if (unpaid.length > 0) {
            nextActions.push({
              command: `pax8 invoices show ${unpaid[0].id}`,
              description: `Review the first unpaid invoice (${unpaid.length} unpaid total)`,
            });
          } else if (invoices.length > 0) {
            nextActions.push({
              command: `pax8 invoices show ${invoices[0].id}`,
              description: "Drill into the most recent invoice",
            });
          }
          nextActions.push({
            command: "pax8 invoices audit --json",
            description: "Audit invoices against active subscriptions for billing discrepancies",
          });
          process.stdout.write(
            JSON.stringify({ invoices, page: pageEnvelope, nextActions }, null, 2) + "\n"
          );
        } else {
          process.stdout.write(
            JSON.stringify({ invoices, page: pageEnvelope }, null, 2) + "\n"
          );
        }
        return;
      }

      const filtersApplied: Record<string, string> = {};
      if (allOpts.company) filtersApplied.company = `"${allOpts.company}"`;
      if (allOpts.status) filtersApplied.status = String(allOpts.status);
      if (allOpts.month) filtersApplied.month = String(allOpts.month);
      if (allOpts.from) filtersApplied.from = String(allOpts.from);
      if (allOpts.to) filtersApplied.to = String(allOpts.to);
      const emptyReasons: string[] = [];
      if (Object.keys(filtersApplied).length === 0) {
        emptyReasons.push("This is a fresh tenant with no historical billing yet.");
      }

      output(numbered, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: "No invoices found.",
          filtersApplied: Object.keys(filtersApplied).length > 0 ? filtersApplied : undefined,
          reasons: emptyReasons.length > 0 ? emptyReasons : undefined,
          suggestions: [
            {
              command: "pax8 invoices list",
              description: "list all invoices (no filters)",
            },
            {
              command: "pax8 invoices list --status Unpaid",
              description: "show only unpaid invoices",
            },
            {
              command: "PAX8_DEMO=1 pax8 invoices list",
              description: "see what an active tenant looks like",
            },
          ],
        },
      });

      if (ctx.outputFormat === "table") {
        renderPaginationFooter(pageEnvelope, {
          resourceSingular: "invoice",
          nextPageCommand,
          rowCount: result.content.length,
        });
        renderReplNavHint(pageEnvelope);
        const userArgv = process.argv.slice(2);
        const first = userArgv[0];
        if (userArgv.length > 0 && first !== "back" && first !== "n" && first !== "p") {
          await saveLastListContext({
            command: userArgv,
            page: {
              number: pageEnvelope.number,
              totalPages: pageEnvelope.totalPages,
            },
          });
        }
        // #418: pickable drill-in.
        await wireListDrillIn({
          rows: result.content,
          resource: "invoices",
          startNum,
          getLabel: (row) =>
            String(
              (row as { companyName?: string }).companyName ?? "Invoice",
            ),
        });
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list invoices");
    }
  });
