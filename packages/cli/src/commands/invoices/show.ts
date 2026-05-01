import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatDate, formatStatus } from "../../lib/formatters.js";
import { replCmd } from "../../lib/confirm.js";

export const invoicesShowCommand = new Command("show")
  .description("Show invoice details")
  .argument("<id>", "Invoice ID")
  .addHelpText(
    "after",
    `
Examples:
  pax8 invoices show inv-summit-curr-001
  pax8 invoices show inv-summit-curr-001 --json
  pax8 invoices show inv-summit-curr-001 --csv`
  )
  .action(async (id, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching invoice...");

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
      process.stdout.write(chalk.bold(`  Invoice ${invoice.id}\n\n`));
      process.stdout.write(`  ${chalk.dim("Company:".padEnd(18))}${invoice.companyName}\n`);
      process.stdout.write(`  ${chalk.dim("Date:".padEnd(18))}${formatDate(invoice.invoiceDate)}\n`);
      process.stdout.write(`  ${chalk.dim("Due Date:".padEnd(18))}${formatDate(invoice.dueDate)}\n`);
      process.stdout.write(`  ${chalk.dim("Status:".padEnd(18))}${formatStatus(invoice.status)}\n`);
      process.stdout.write(`  ${chalk.dim("Total:".padEnd(18))}${formatCurrency(invoice.total)}\n`);
      process.stdout.write(`  ${chalk.dim("Balance:".padEnd(18))}${formatCurrency(invoice.balance)}\n`);
      // Next steps
      if (ctx.outputFormat === "table") {
        process.stderr.write(chalk.dim("  Try next:\n"));
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 invoices items ${invoice.id}`))}  ${chalk.dim("view line items")}\n`);
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 companies more "${invoice.companyName}"`))}  ${chalk.dim("view company")}\n`);
        process.stderr.write("\n");
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to show invoice");
    }
  });
