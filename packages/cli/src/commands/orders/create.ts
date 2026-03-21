import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { confirm } from "../../lib/confirm.js";
import { formatStatus, formatDate } from "../../lib/formatters.js";
import type { CreateOrderInput } from "@pax8/core";

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

      // Resolve names for a human-friendly preview
      let companyName = allOpts.company;
      let productName = allOpts.product;
      try {
        const [company, product] = await Promise.all([
          ctx.api.companies.get(allOpts.company).catch(() => null),
          ctx.api.products.get(allOpts.product).catch(() => null),
        ]);
        if (company?.name) companyName = company.name;
        if (product?.name) productName = product.name;
      } catch { /* best effort */ }

      process.stderr.write(chalk.bold("\n  📦 Order Preview:\n\n"));
      process.stderr.write(`  ${chalk.dim("Company:")}      ${companyName}\n`);
      process.stderr.write(`  ${chalk.dim("Product:")}      ${productName}\n`);
      process.stderr.write(`  ${chalk.dim("Quantity:")}     ${quantity}\n`);
      process.stderr.write(`  ${chalk.dim("Billing Term:")} ${allOpts.billingTerm}\n`);
      process.stderr.write("\n");

      const confirmed = await confirm("Place this order?", { default: true });
      if (!confirmed) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Creating order...").start();

      // Only pass fields defined in OrderLineItemInput — do not include
      // display-only fields like productName which are not part of the API input schema.
      const orderInput: CreateOrderInput = {
        companyId: allOpts.company,
        lineItems: [
          {
            productId: allOpts.product,
            quantity,
            billingTerm: allOpts.billingTerm,
          },
        ],
      };
      const order = await ctx.api.orders.create(orderInput);

      spinner.succeed("Order created 🎉");

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(order, null, 2) + "\n");
        return;
      }

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("Order ID:".padEnd(18))}${order.id}\n`);
      if (order.status) process.stdout.write(`  ${chalk.dim("Status:".padEnd(18))}${formatStatus(order.status)}\n`);
      process.stdout.write(`  ${chalk.dim("Date:".padEnd(18))}${formatDate(order.createdDate)}\n`);
      if (order.lineItems && order.lineItems.length > 0) {
        process.stdout.write(`  ${chalk.dim("Items:".padEnd(18))}${order.lineItems.length}\n`);
      }
      // Next steps
      process.stderr.write(chalk.dim("  Try next:\n"));
      process.stderr.write(`    ${chalk.cyan(`pax8 orders show ${order.id}`)}  ${chalk.dim("check order status")}\n`);
      process.stderr.write(`    ${chalk.cyan(`pax8 subscriptions list --company ${allOpts.company}`)}  ${chalk.dim("view subscriptions")}\n`);
      process.stderr.write("\n");
    } catch (error) {
      handleCommandError(error, undefined, "Failed to create order");
    }
  });
