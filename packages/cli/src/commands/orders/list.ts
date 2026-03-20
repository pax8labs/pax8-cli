import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { formatStatus, formatDate } from "../../lib/formatters.js";

const columns: Column[] = [
  { key: "id", header: "ID" },
  { key: "companyName", header: "Company" },
  { key: "createdDate", header: "Date", format: (v: string) => formatDate(v) },
  { key: "status", header: "Status", format: (v: string) => formatStatus(v) },
];

export const ordersListCommand = new Command("list")
  .description("List orders")
  .option("--company <id>", "Filter by company ID")
  .option("--page <number>", "Page number (zero-based)", "0")
  .option("--size <number>", "Page size", "25")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 orders list
  pax8 orders list --company a1b2c3d4-e5f6-7890-abcd-ef1234567890
  pax8 orders list --page 1 --size 25
  pax8 orders list --json`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const spinner = createSpinner("Fetching orders...").start();

    try {
      const ctx = await buildContext(allOpts);
      const params: any = {
        page: parseInt(allOpts.page, 10),
        size: parseInt(allOpts.size, 10),
      };
      if (allOpts.company) {
        params.companyId = allOpts.company;
      }

      const result = await ctx.api.orders.list(params);

      spinner.stop();

      if (allOpts.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      output(result.content, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        process.stderr.write(
          chalk.dim(`\n  ${result.page.totalElements} orders\n\n`)
        );
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to list orders");
    }
  });
