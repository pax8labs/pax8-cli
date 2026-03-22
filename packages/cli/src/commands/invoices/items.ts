import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency } from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";

export const invoicesItemsCommand = new Command("items")
  .description("List invoice line items")
  .option("--month <YYYY-MM>", "Filter by month (YYYY-MM)")
  .option("--company <id|name>", "Filter by company ID or name")
  .option("--invoice-id <id>", "Filter by invoice ID")
  .option("--page <number>", "Page number (0-based)", "0")
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
      const result = await ctx.api.invoices.listItems({
        month: options.month,
        companyId,
        invoiceId: options.invoiceId,
        page: parseInt(options.page, 10),
        size: parseInt(options.size, 10),
      });
      spinner.stop();

      const columns = [
        { key: "productName", header: "Product", width: 35 },
        { key: "companyName", header: "Company", width: 22 },
        { key: "quantity", header: "Qty", width: 8 },
        {
          key: "unitPrice",
          header: "Unit Price",
          width: 14,
          format: (v) => formatCurrency(Number(v)),
        },
        {
          key: "total",
          header: "Subtotal",
          width: 14,
          format: (v) => formatCurrency(Number(v)),
        },
      ];

      output(result.content, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        process.stderr.write(
          chalk.dim(`\n  ${result.page.totalElements} items\n\n`)
        );
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to list invoice items");
    }
  });
