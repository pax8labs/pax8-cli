import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/confirm.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";

export const contactsDeleteCommand = new Command("delete")
  .description("Delete a contact")
  .argument("<id>", "Contact ID")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 contacts delete contact-summit-001
  pax8 contacts delete contact-summit-001 --yes`
  )
  .action(async (id, _options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);

    try {
      const spinner = createSpinner("Fetching contact...").start();
      const contact = await ctx.api.contacts.get(id);
      spinner.stop();

      if (ctx.outputFormat !== "quiet") {
        process.stderr.write(chalk.red.bold("\n  Contact to be deleted:\n\n"));
        process.stderr.write(`  ${chalk.bold("ID")}        ${contact.id}\n`);
        process.stderr.write(`  ${chalk.bold("Name")}      ${contact.firstName} ${contact.lastName}\n`);
        process.stderr.write(`  ${chalk.bold("Email")}     ${contact.email}\n`);
        process.stderr.write(`  ${chalk.bold("Types")}     ${(contact.types ?? []).join(", ") || "—"}\n`);
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

      const delSpinner = createSpinner("Deleting contact...").start();
      const doneDelete = markWriteInFlight("contacts");
      try {
        await ctx.api.contacts.delete(id);
      } finally {
        doneDelete();
      }
      await invalidateCacheAfterWrite();
      delSpinner.succeed("Contact deleted");

      if (ctx.outputFormat === "json") {
        output([{ id: contact.id, status: "Deleted" }], { format: "json" });
      }
    } catch (error) {
      handleCommandError(error, undefined, "Failed to delete contact");
    }
  });
