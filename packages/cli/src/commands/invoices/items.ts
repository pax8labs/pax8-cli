// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency } from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";

export const invoicesItemsCommand = new Command("items")
  .description("List invoice line items")
  .option("--month <YYYY-MM>", "Filter by month (YYYY-MM)")
  .option("--company <id|name>", "Filter by company ID or name")
  .option("--invoice-id <id>", "Filter by invoice ID")
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", "Page size", "25")
  .addHelpText(
    "after",
    `
Examples:
  pax8 invoices items
  pax8 invoices items --month 2026-03
  pax8 invoices items --invoice-id inv-summit-curr-001
  pax8 invoices items --json`
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching invoice items…");

    try {
      spinner.start();
      const companyId = options.company
        ? await resolveCompanyId(ctx, options.company)
        : undefined;
      const apiPage = Math.max(parseInt(options.page, 10) - 1, 0);
      const result = await ctx.api.invoices.listItems({
        month: options.month,
        companyId,
        invoiceId: options.invoiceId,
        page: apiPage,
        size: parseInt(options.size, 10),
      });
      spinner.stop();

      const columns: Column[] = [
        { key: "productName", header: "Product", width: 35 },
        { key: "companyName", header: "Company", width: 22 },
        { key: "quantity", header: "Qty", width: 8 },
        {
          key: "price",
          header: "Unit Price",
          width: 14,
          format: (v) => formatCurrency(Number(v)),
        },
        {
          key: "subTotal",
          header: "Subtotal",
          width: 14,
          format: (v) => formatCurrency(Number(v)),
        },
      ];

      const emptyReasons: string[] = [];
      const filterDesc: string[] = [];
      if (options.company) filterDesc.push(`company "${options.company}"`);
      if (options.month) filterDesc.push(`month ${options.month}`);
      if (options.invoiceId) filterDesc.push(`invoice ${options.invoiceId}`);
      if (filterDesc.length > 0) {
        emptyReasons.push(
          `No invoice items match the filters: ${filterDesc.join(", ")}.`,
        );
      } else {
        emptyReasons.push("No invoiced line items are recorded yet.");
      }

      output(result.content, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: "No invoice items found.",
          reasons: emptyReasons,
          suggestions: [
            {
              command: "pax8 invoices list",
              description: "browse invoices first",
            },
          ],
        },
      });

      if (ctx.outputFormat === "table" && result.content.length > 0) {
        process.stderr.write(
          chalk.dim(`\n  ${result.page.totalElements} items\n\n`)
        );
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list invoice items");
    }
  });
