// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { buildContext } from "../../lib/context.js";
import {
  output,
  type Column,
  buildPageEnvelope,
  renderPaginationFooter,
  displayCommandFromArgs,
} from "../../lib/output.js";
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

      // #483: wrap JSON output as { items, page } and standardize footer.
      // #562: argv form for next-page nav. items doesn't emit nextActions
      // today, so only the human pagination footer reads this display
      // form — but standardize the construction anyway to make any
      // future --with-actions rollout safe-by-default.
      const pageEnvelope = buildPageEnvelope(result.page);
      const nextPageArgs: string[] = [
        "pax8", "invoices", "items",
        "--page", String(pageEnvelope.number + 1),
        "--size", String(pageEnvelope.size),
        ...(options.company ? ["--company", String(options.company)] : []),
        ...(options.month ? ["--month", String(options.month)] : []),
        ...(options.invoiceId ? ["--invoice-id", String(options.invoiceId)] : []),
      ];
      const nextPageCommand = displayCommandFromArgs(nextPageArgs);

      if (ctx.outputFormat === "json") {
        process.stdout.write(
          JSON.stringify({ items: result.content, page: pageEnvelope }, null, 2) + "\n",
        );
        return;
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

      if (ctx.outputFormat === "table") {
        renderPaginationFooter(pageEnvelope, {
          resourceSingular: "item",
          nextPageCommand,
          rowCount: result.content.length,
        });
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list invoice items");
    }
  });
