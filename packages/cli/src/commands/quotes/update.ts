import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { confirm, replCmd } from "../../lib/confirm.js";
import { resolveProduct } from "../../lib/resolve-product.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import type { UpdateQuoteInput, BillingTerm } from "@pax8/core";

export const quotesUpdateCommand = new Command("update")
  .description("Update a quote (replace line items or change expiration)")
  .argument("<id>", "Quote ID")
  .option("--product <id|name>", "Replace line items with a single line for this product")
  .option("--quantity <number>", "Quantity for the replacement line item", "1")
  .option("--billing-term <term>", "Billing term (Monthly or Annual)", "Monthly")
  .option("--expiration-date <date>", "New expiration date (YYYY-MM-DD)")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 quotes update quote-summit-001 --expiration-date 2026-05-15
  pax8 quotes update quote-bright-001 --product "Microsoft 365 E3" --quantity 20`
  )
  .action(async (id, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);

    try {
      const data: UpdateQuoteInput = {};

      if (options.product) {
        const quantity = parseInt(options.quantity, 10);
        if (isNaN(quantity) || quantity <= 0) {
          throw new CliError(
            `Invalid quantity: "${options.quantity}"`,
            ["Quantity must be a positive integer"],
          );
        }
        const product = await resolveProduct(ctx, options.product);
        data.lineItems = [
          {
            productId: product.id,
            quantity,
            billingTerm: options.billingTerm as BillingTerm,
          },
        ];
      }

      if (options.expirationDate) {
        data.expirationDate = options.expirationDate;
      }

      if (Object.keys(data).length === 0) {
        throw new CliError(
          "No fields to update",
          ["Use --product (with --quantity) to replace line items, or --expiration-date"],
          [`Try: ${replCmd("pax8 quotes update")} ${id} --expiration-date 2026-05-15`],
        );
      }

      const spinner = createSpinner("Fetching quote...").start();
      const current = await ctx.api.quotes.get(id);
      spinner.stop();

      process.stderr.write(chalk.bold("\n  Update Quote:\n\n"));
      process.stderr.write(`  ${chalk.dim("ID:".padEnd(18))}${current.id}\n`);
      process.stderr.write(`  ${chalk.dim("Current status:".padEnd(18))}${current.status}\n`);
      if (data.expirationDate) {
        process.stderr.write(`  ${chalk.dim("New expiration:".padEnd(18))}${chalk.green(data.expirationDate)}\n`);
      }
      if (data.lineItems) {
        process.stderr.write(`  ${chalk.dim("New line items:".padEnd(18))}${chalk.green(`${data.lineItems.length} item(s)`)}\n`);
      }
      process.stderr.write("\n");

      const ok = await confirm("Apply these changes?", { default: true });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const updateSpinner = createSpinner("Updating quote...").start();
      const updated = await ctx.api.quotes.update(id, data);
      await invalidateCacheAfterWrite();
      updateSpinner.succeed("Quote updated");

      if (ctx.outputFormat === "json") {
        output([updated as unknown as Record<string, unknown>], { format: "json" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("ID:".padEnd(14))}${updated.id}\n`);
      process.stdout.write(`  ${chalk.dim("Status:".padEnd(14))}${updated.status}\n`);
      if (updated.expirationDate) {
        process.stdout.write(`  ${chalk.dim("Expires:".padEnd(14))}${updated.expirationDate}\n`);
      }
      process.stdout.write(`  ${chalk.dim("Items:".padEnd(14))}${updated.lineItems?.length ?? 0}\n`);
      process.stdout.write("\n");
    } catch (error) {
      handleCommandError(error, undefined, "Failed to update quote");
    }
  });
