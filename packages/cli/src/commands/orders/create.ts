import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { confirm } from "../../lib/confirm.js";

export const ordersCreateCommand = new Command("create")
  .description("Create a new order")
  .requiredOption("--company <id>", "Company ID (required)")
  .requiredOption("--product <id>", "Product ID (required)")
  .option("--quantity <number>", "Quantity", "1")
  .option("--billing-term <term>", "Billing term (Monthly or Annual)", "Monthly")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 orders create --company a1b2c3d4-e5f6-7890-abcd-ef1234567890 --product prod-m365-biz-prem-0001 --quantity 5
  pax8 orders create --company a1b2c3d4 --product prod-123 --quantity 10 --billing-term Annual
  pax8 orders create --company a1b2c3d4 --product prod-123 --yes`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    try {
      const ctx = await buildContext(allOpts);
      const quantity = parseInt(allOpts.quantity, 10);

      // Show pricing preview
      process.stderr.write(chalk.bold("\n  Order Preview:\n\n"));
      process.stderr.write(`  ${chalk.dim("Company:")}      ${allOpts.company}\n`);
      process.stderr.write(`  ${chalk.dim("Product:")}      ${allOpts.product}\n`);
      process.stderr.write(`  ${chalk.dim("Quantity:")}     ${quantity}\n`);
      process.stderr.write(`  ${chalk.dim("Billing Term:")} ${allOpts.billingTerm}\n`);
      process.stderr.write("\n");

      const confirmed = await confirm("Place this order?", { default: true });
      if (!confirmed) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Creating order...").start();

      const order = await ctx.api.orders.create({
        companyId: allOpts.company,
        lineItems: [
          {
            productId: allOpts.product,
            productName: allOpts.product,
            quantity,
            billingTerm: allOpts.billingTerm,
          },
        ],
      });

      spinner.succeed("Order created");

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(order, null, 2) + "\n");
        return;
      }

      process.stdout.write("\n");
      process.stdout.write(chalk.bold(`  Order ${order.id}\n\n`));
      process.stdout.write(`  ${chalk.dim("Status:")}  ${order.status}\n`);
      process.stdout.write(`  ${chalk.dim("Date:")}    ${order.createdDate}\n`);
      if (order.lineItems && order.lineItems.length > 0) {
        process.stdout.write(`  ${chalk.dim("Items:")}   ${order.lineItems.length}\n`);
      }
      process.stdout.write("\n");
    } catch (error) {
      handleCommandError(error, undefined, "Failed to create order");
    }
  });
