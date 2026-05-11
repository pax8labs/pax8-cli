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

export const invoicesListCommand = new Command("list")
  .description("List invoices")
  .option("--month <YYYY-MM>", "Filter by month (YYYY-MM)")
  .option("--company <id|name>", "Filter by company ID or name")
  // Help text mirrors the full public OpenAPI enum for `GET /invoices`'s
  // `status` query parameter (#250). Previously the help listed only 4 of the
  // 6 documented values (`Nothing Due` and `Credited` were missing).
  .option(
    "--status <status>",
    'Filter by status (Unpaid, Paid, Void, Carried, "Nothing Due", Credited)'
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
  pax8 invoices list --company "Summit Healthcare"
  pax8 invoices list --status Unpaid
  pax8 invoices list --json
  pax8 invoices list --json --with-actions
  pax8 invoices list --csv
  pax8 invoices list --ids-only | xargs -I{} pax8 invoices show {}`
  )
  .action(async (options, command) => {
    const allOpts = command.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching invoices...");

    try {
      spinner.start();
      const companyId = allOpts.company
        ? await resolveCompanyId(ctx, allOpts.company)
        : undefined;
      const apiPage = Math.max(parseInt(allOpts.page, 10) - 1, 0);
      const result = await ctx.api.invoices.list({
        month: allOpts.month,
        companyId,
        status: allOpts.status,
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

      output(result.content, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        process.stderr.write(
          chalk.dim(`\n  ${result.page.totalElements} invoices\n\n`)
        );
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list invoices");
    }
  });
