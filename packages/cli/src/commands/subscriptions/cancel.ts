import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/confirm.js";
import { formatCurrency, formatQuantity } from "../../lib/formatters.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";

export const subscriptionsCancelCommand = new Command("cancel")
  .description("Cancel a subscription")
  .argument("<id>", "Subscription ID")
  .option("-y, --yes", "Skip confirmation prompts")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions cancel sub-summit-m365bp-001
  pax8 subscriptions cancel sub-summit-m365bp-001 --yes`
  )
  .action(async (id, options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);

    try {
      // Fetch subscription details to show what will be cancelled
      const spinner = createSpinner("Fetching subscription...").start();
      const sub = await ctx.api.subscriptions.get(id);
      spinner.stop();

      // Calculate MRR impact
      const mrr =
        sub.billingTerm === "Annual"
          ? (sub.price * sub.quantity) / 12
          : sub.price * sub.quantity;

      if (ctx.outputFormat !== "quiet") {
        process.stdout.write(chalk.red.bold("\n  Subscription to be cancelled:\n\n"));
        process.stdout.write(`  ${chalk.bold("Company")}      ${sub.companyName ?? sub.companyId}\n`);
        process.stdout.write(`  ${chalk.bold("Product")}      ${sub.productName}\n`);
        process.stdout.write(`  ${chalk.bold("Quantity")}     ${formatQuantity(sub.quantity)}\n`);
        process.stdout.write(`  ${chalk.bold("MRR Impact")}   ${chalk.red("-" + formatCurrency(mrr))}\n`);
        process.stdout.write("\n");
      }

      // Destructive confirmation
      const confirmed = await confirmDestructive(
        "This action cannot be undone.",
        "cancel"
      );

      if (!confirmed) {
        process.stderr.write(chalk.yellow("\n  Cancellation aborted.\n\n"));
        return;
      }

      const cancelSpinner = createSpinner("Cancelling subscription...").start();
      await ctx.api.subscriptions.delete(id);
      await invalidateCacheAfterWrite();
      cancelSpinner.succeed("Subscription cancelled");

      if (ctx.outputFormat === "json") {
        output([{ id: sub.id, status: "Cancelled" }], { format: "json" });
      }

      // Next steps
      process.stderr.write(chalk.dim("\n  Try next:\n"));
      process.stderr.write(`    ${chalk.cyan(`pax8 subscriptions list --company ${sub.companyId}`)}  ${chalk.dim("remaining subscriptions")}\n`);
      process.stderr.write(`    ${chalk.cyan(`pax8 orders create --company ${sub.companyId} --product <id>`)}  ${chalk.dim("order a replacement")}\n`);
      process.stderr.write("\n");
    } catch (error) {
      handleCommandError(error, undefined, "Failed to cancel subscription");
    }
  });
