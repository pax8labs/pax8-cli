import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/confirm.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";

export const quotesDeleteCommand = new Command("delete")
  .description("Delete a quote")
  .argument("<id>", "Quote ID")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 quotes delete quote-summit-001
  pax8 quotes delete quote-summit-001 --yes`
  )
  .action(async (id, _options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);

    try {
      const spinner = createSpinner("Fetching quote...").start();
      const quote = await ctx.api.quotes.get(id);
      spinner.stop();

      if (ctx.outputFormat !== "quiet") {
        process.stderr.write(chalk.red.bold("\n  Quote to be deleted:\n\n"));
        process.stderr.write(`  ${chalk.bold("ID")}        ${quote.id}\n`);
        process.stderr.write(`  ${chalk.bold("Status")}    ${quote.status}\n`);
        process.stderr.write(`  ${chalk.bold("Items")}     ${quote.lineItems?.length ?? 0}\n`);
        process.stderr.write("\n");
      }

      const confirmed = await confirmDestructive(
        "This action cannot be undone.",
        "delete"
      );
      if (!confirmed) {
        process.stderr.write(chalk.yellow("\n  Deletion aborted.\n\n"));
        return;
      }

      const delSpinner = createSpinner("Deleting quote...").start();
      const doneDelete = markWriteInFlight("quotes");
      try {
        await ctx.api.quotes.delete(id);
      } finally {
        doneDelete();
      }
      await invalidateCacheAfterWrite();
      delSpinner.succeed("Quote deleted");

      if (ctx.outputFormat === "json") {
        output([{ id: quote.id, status: "Deleted" }], { format: "json" });
      }
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to delete quote");
    }
  });
