import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { confirm, replCmd } from "../../lib/confirm.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";

export const webhooksDeleteCommand = new Command("delete")
  .description("Delete a webhook subscription")
  .argument("<id>", "Webhook ID")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks delete 11111111-2222-3333-4444-555555555501
  pax8 webhooks delete 11111111-2222-3333-4444-555555555501 --yes`,
  )
  .action(async (id: string, _options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    try {
      const ctx = await buildContext(allOpts);

      // Look up the webhook so we can show useful detail in the prompt
      // and emit a clean error if it doesn't exist.
      const fetchSpinner = createSpinner("Fetching webhook...").start();
      const webhook = await ctx.api.webhooks.get(id);
      fetchSpinner.stop();

      process.stderr.write(chalk.bold("\n  Deleting webhook subscription:\n\n"));
      process.stderr.write(`  ${chalk.dim("ID:".padEnd(10))}${webhook.id}\n`);
      process.stderr.write(`  ${chalk.dim("URL:".padEnd(10))}${webhook.url}\n`);
      process.stderr.write(`  ${chalk.dim("Events:".padEnd(10))}${webhook.topics.join(", ")}\n`);
      process.stderr.write(`  ${chalk.dim("Status:".padEnd(10))}${webhook.status}\n`);
      process.stderr.write("\n");

      process.stderr.write(
        chalk.yellow("  ⚠ This will stop all event deliveries to this URL.\n\n"),
      );

      const confirmed = await confirm("Delete this webhook?", { default: false });
      if (!confirmed) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Deleting webhook...").start();
      const doneDelete = markWriteInFlight("webhooks");
      try {
        await ctx.api.webhooks.delete(id);
      } finally {
        doneDelete();
      }
      await invalidateCacheAfterWrite();
      spinner.succeed("Webhook deleted");

      if (ctx.outputFormat === "json") {
        const nextActions = [
          {
            command: "pax8 webhooks list",
            description: "View remaining webhook subscriptions",
          },
        ];
        process.stdout.write(
          JSON.stringify({ id, deleted: true, nextActions }, null, 2) + "\n",
        );
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stderr.write(chalk.dim("\n  Try next:\n"));
      process.stderr.write(
        `    ${chalk.cyan(replCmd("pax8 webhooks list"))}  ${chalk.dim("view remaining subscriptions")}\n`,
      );
      process.stderr.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to delete webhook");
    }
  });
