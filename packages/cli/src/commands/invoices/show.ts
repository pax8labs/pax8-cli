import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatDate, formatStatus } from "../../lib/formatters.js";

export const invoicesShowCommand = new Command("show")
  .description("Show invoice details")
  .argument("<id>", "Invoice ID")
  .addHelpText(
    "after",
    `
Examples:
  pax8 invoices show inv-acme-curr-001
  pax8 invoices show inv-acme-curr-001 --json`
  )
  .action(async (id, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching invoice…");

    try {
      spinner.start();
      const invoice = await ctx.api.invoices.get(id);
      spinner.stop();

      if (ctx.outputFormat === "json") {
        output([invoice], { format: "json" });
        return;
      }

      if (ctx.outputFormat === "csv") {
        const columns = [
          { key: "id", header: "ID" },
          { key: "companyName", header: "Company" },
          { key: "invoiceDate", header: "Date" },
          { key: "dueDate", header: "Due Date" },
          { key: "status", header: "Status" },
          { key: "total", header: "Total" },
          { key: "balance", header: "Balance" },
          { key: "currency", header: "Currency" },
        ];
        output([invoice], { format: "csv", columns });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      // Human-readable output
      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.bold("Invoice")} ${invoice.id}\n`);
      process.stdout.write(`  ${chalk.dim("Company:")} ${invoice.companyName}\n`);
      process.stdout.write(
        `  ${chalk.dim("Date:")} ${formatDate(invoice.invoiceDate)}\n`
      );
      process.stdout.write(
        `  ${chalk.dim("Due Date:")} ${formatDate(invoice.dueDate)}\n`
      );
      process.stdout.write(
        `  ${chalk.dim("Status:")} ${formatStatus(invoice.status)}\n`
      );
      process.stdout.write(
        `  ${chalk.dim("Total:")} ${formatCurrency(invoice.total)}\n`
      );
      process.stdout.write(
        `  ${chalk.dim("Balance:")} ${formatCurrency(invoice.balance)}\n`
      );
      process.stdout.write(
        `  ${chalk.dim("Currency:")} ${invoice.currency}\n`
      );
      process.stdout.write("\n");
    } catch (error) {
      handleCommandError(error, spinner, "Failed to show invoice");
    }
  });
