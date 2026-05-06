import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { formatStatus, formatDate } from "../../lib/formatters.js";

const lineItemColumns: Column[] = [
  { key: "productName", header: "Product" },
  { key: "quantity", header: "Qty" },
  { key: "billingTerm", header: "Term" },
];

export const ordersShowCommand = new Command("show")
  .description("Show order details")
  .argument("<id>", "Order ID")
  .addHelpText(
    "after",
    `
Examples:
  pax8 orders show ord-summit-001
  pax8 orders show ord-summit-001 --json
  pax8 orders show ord-summit-001 --csv`
  )
  .action(async (id: string, options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const spinner = createSpinner("Fetching order...").start();

    try {
      const ctx = await buildContext(allOpts);
      const order = await ctx.api.orders.get(id);

      spinner.stop();

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(order, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "csv") {
        output([order], {
          format: "csv",
          columns: [
            { key: "id", header: "ID" },
            { key: "companyName", header: "Company" },
            { key: "createdDate", header: "Date" },
            { key: "status", header: "Status" },
            { key: "orderedBy", header: "Ordered By" },
          ],
        });
        return;
      }

      // Table / detail view
      process.stdout.write("\n");
      process.stdout.write(chalk.bold(`  Order ${order.id}\n\n`));
      process.stdout.write(`  ${chalk.dim("Company:".padEnd(18))}${order.companyName}\n`);
      if (order.status) process.stdout.write(`  ${chalk.dim("Status:".padEnd(18))}${formatStatus(order.status)}\n`);
      process.stdout.write(`  ${chalk.dim("Date:".padEnd(18))}${formatDate(order.createdDate)}\n`);
      process.stdout.write(`  ${chalk.dim("Ordered By:".padEnd(18))}${order.orderedBy}${order.orderedByEmail ? ` (${order.orderedByEmail})` : ""}\n`);
      process.stdout.write("\n");

      if (order.lineItems && order.lineItems.length > 0) {
        process.stdout.write(chalk.dim(`  Line Items (${order.lineItems.length}):\n\n`));
        output(order.lineItems, { format: "table", columns: lineItemColumns });
        process.stdout.write("\n");
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to show order");
    }
  });
