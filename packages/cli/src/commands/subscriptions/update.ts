import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { confirm } from "../../lib/confirm.js";
import { formatQuantity, formatCurrency, formatStatus } from "../../lib/formatters.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";

export const subscriptionsUpdateCommand = new Command("update")
  .description("Update a subscription")
  .argument("<id>", "Subscription ID")
  .option("--quantity <number>", "New quantity")
  .option("--billing-term <term>", "New billing term (Monthly or Annual)")
  .option("-y, --yes", "Skip confirmation prompts")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions update sub-summit-m365bp-001 --quantity 50
  pax8 subscriptions update sub-summit-m365bp-001 --billing-term Annual
  pax8 subscriptions update sub-summit-m365bp-001 --quantity 30 --yes`
  )
  .action(async (id, options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);

    try {
      // First, fetch the current subscription
      const spinner = createSpinner("Fetching subscription...").start();
      const sub = await ctx.api.subscriptions.get(id);
      spinner.stop();

      const updateData: Record<string, unknown> = {};

      if (options.quantity !== undefined) {
        const newQty = parseInt(options.quantity, 10);

        // Warn on quantity reduction
        if (newQty < sub.quantity) {
          const confirmed = await confirm(
            `This will reduce from ${sub.quantity} to ${newQty} seats. Continue?`
          );
          if (!confirmed) {
            process.stderr.write(chalk.yellow("\n  Update cancelled.\n\n"));
            return;
          }
        }

        updateData.quantity = newQty;
      }

      if (options.billingTerm) {
        updateData.billingTerm = options.billingTerm;
      }

      if (Object.keys(updateData).length === 0) {
        process.stderr.write(
          chalk.yellow("\n  No changes specified. Use --quantity or --billing-term.\n\n")
        );
        return;
      }

      const updateSpinner = createSpinner("Updating subscription...").start();
      const updated = await ctx.api.subscriptions.update(id, updateData);
      await invalidateCacheAfterWrite();
      updateSpinner.succeed("Subscription updated");

      if (ctx.outputFormat === "json") {
        output([updated], { format: "json" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("ID:".padEnd(18))}${updated.id}\n`);
      process.stdout.write(`  ${chalk.dim("Product:".padEnd(18))}${updated.productName}\n`);
      process.stdout.write(`  ${chalk.dim("Status:".padEnd(18))}${formatStatus(updated.status)}\n`);
      process.stdout.write(`  ${chalk.dim("Quantity:".padEnd(18))}${formatQuantity(updated.quantity)}\n`);
      process.stdout.write(`  ${chalk.dim("Billing Term:".padEnd(18))}${updated.billingTerm}\n`);
      process.stdout.write(`  ${chalk.dim("Price:".padEnd(18))}${formatCurrency(updated.price)}\n`);
      process.stdout.write("\n");
    } catch (error) {
      handleCommandError(error, undefined, "Failed to update subscription");
    }
  });
