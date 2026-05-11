// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { confirmDestructive, replCmd } from "../../lib/confirm.js";
import { resolveCompany } from "../../lib/resolve-company.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";

export const contactsDeleteCommand = new Command("delete")
  .description("Delete a contact")
  .argument("<id>", "Contact ID")
  .option("--company <id|name>", "Owning company ID or name (required)")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 contacts delete contact-summit-001 --company "Summit Healthcare Partners"
  pax8 contacts delete contact-summit-001 --company a1b2c3d4 --yes

Notes:
  Contacts in the Pax8 public API are addressed only under their owning
  company (\`DELETE /v1/companies/{companyId}/contacts/{contactId}\`). The
  \`--company\` flag is required; there is no flat delete endpoint.`
  )
  .action(async (id, _options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);

    try {
      if (!globalOpts.company) {
        throw new CliError(
          "--company is required",
          [
            "Contacts in v2 must be addressed under a company. Pass `--company <id|name>`.",
            "(Previously: `pax8 contacts delete <contact-id>`.)",
          ],
          [
            `Pick a company first: ${replCmd("pax8 companies list")}`,
            `Then: ${replCmd(`pax8 contacts delete ${id}`)} --company <id|name>`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      const spinner = createSpinner("Fetching contact...").start();
      const company = await resolveCompany(ctx, globalOpts.company);
      const contact = await ctx.api.contacts.get(company.id, id);
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
        await ctx.api.contacts.delete(company.id, id);
      } finally {
        doneDelete();
      }
      await invalidateCacheAfterWrite();
      delSpinner.succeed("Contact deleted");

      if (ctx.outputFormat === "json") {
        output([{ id: contact.id, status: "Deleted" }], { format: "json" });
      }
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to delete contact");
    }
  });
