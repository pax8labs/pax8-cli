// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatDate, formatStatus } from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { validateEnum } from "../../lib/validate.js";

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
  .option("--size <number>", "Page size", "25")
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
      const result = await ctx.api.invoices.list({
        month: allOpts.month,
        companyId,
        status: allOpts.status,
        invoiceDateRangeStart: allOpts.from,
        invoiceDateRangeEnd: allOpts.to,
        sort,
        page: apiPage,
        size: parseInt(allOpts.size, 10),
      });
      spinner.stop();

      if (allOpts.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      const columns: Column[] = [
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

      if (ctx.outputFormat === "json" && options.withActions) {
        const nextActions: { command: string; description: string }[] = [];
        const invoices = result.content;
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
          JSON.stringify({ invoices: result.content, nextActions }, null, 2) + "\n"
        );
        return;
      }

      const emptyReasons: string[] = [];
      const filterDesc: string[] = [];
      if (allOpts.company) filterDesc.push(`company "${allOpts.company}"`);
      if (allOpts.status) filterDesc.push(`status ${allOpts.status}`);
      if (allOpts.month) filterDesc.push(`month ${allOpts.month}`);
      if (filterDesc.length > 0) {
        emptyReasons.push(
          `No invoices match the filters: ${filterDesc.join(", ")}.`,
        );
      } else {
        emptyReasons.push("This is a fresh tenant with no historical billing yet.");
      }

      output(result.content, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: "No invoices found.",
          reasons: emptyReasons,
          suggestions: [
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

      if (ctx.outputFormat === "table" && result.content.length > 0) {
        process.stderr.write(
          chalk.dim(`\n  ${result.page.totalElements} invoices\n\n`)
        );
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list invoices");
    }
  });
