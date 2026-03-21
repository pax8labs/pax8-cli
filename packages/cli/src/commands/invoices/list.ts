import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatDate, formatStatus } from "../../lib/formatters.js";

export const invoicesListCommand = new Command("list")
  .description("List invoices")
  .option("--month <YYYY-MM>", "Filter by month (YYYY-MM)")
  .option("--company <id>", "Filter by company ID")
  .option("--page <number>", "Page number (0-based)", "0")
  .option("--size <number>", "Page size", "25")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 invoices list
  pax8 invoices list --month 2026-03
  pax8 invoices list --company a1b2c3d4-e5f6-7890-abcd-ef1234567890
  pax8 invoices list --json`
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching invoices...");

    try {
      spinner.start();
      const result = await ctx.api.invoices.list({
        month: options.month,
        companyId: options.company,
        page: parseInt(options.page, 10),
        size: parseInt(options.size, 10),
      });
      spinner.stop();

      if (globalOpts.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      const columns = [
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

      output(result.content, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        process.stderr.write(
          chalk.dim(`\n  ${result.page.totalElements} invoices\n\n`)
        );
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to list invoices");
    }
  });
