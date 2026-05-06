// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { replCmd } from "../../lib/confirm.js";

export const contactsShowCommand = new Command("show")
  .description("Show contact details")
  .argument("<id>", "Contact ID")
  .addHelpText(
    "after",
    `
Examples:
  pax8 contacts show contact-summit-001
  pax8 contacts show contact-summit-001 --json
  pax8 contacts show contact-summit-001 --csv`
  )
  .action(async (id, _options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching contact...");

    try {
      spinner.start();
      const contact = await ctx.api.contacts.get(id);
      spinner.stop();

      if (ctx.outputFormat === "json") {
        output([contact], { format: "json" });
        return;
      }

      if (ctx.outputFormat === "csv") {
        const columns = [
          { key: "id", header: "ID" },
          { key: "firstName", header: "First Name" },
          { key: "lastName", header: "Last Name" },
          { key: "email", header: "Email" },
          { key: "phone", header: "Phone" },
          { key: "companyId", header: "Company ID" },
          { key: "types", header: "Types", format: (v: unknown) => Array.isArray(v) ? v.join("|") : String(v ?? "") },
        ];
        output([contact], { format: "csv", columns });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(chalk.bold(`  Contact ${contact.id}\n\n`));
      process.stdout.write(`  ${chalk.dim("Name:".padEnd(14))}${contact.firstName} ${contact.lastName}\n`);
      process.stdout.write(`  ${chalk.dim("Email:".padEnd(14))}${contact.email}\n`);
      if (contact.phone) {
        process.stdout.write(`  ${chalk.dim("Phone:".padEnd(14))}${contact.phone}\n`);
      }
      process.stdout.write(`  ${chalk.dim("Types:".padEnd(14))}${(contact.types ?? []).join(", ") || "—"}\n`);
      process.stdout.write(`  ${chalk.dim("Company ID:".padEnd(14))}${contact.companyId}\n`);
      process.stdout.write("\n");

      process.stderr.write(chalk.dim("  Try next:\n"));
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 contacts update ${contact.id} --email <new-email>`))}  ${chalk.dim("update this contact")}\n`);
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 contacts delete ${contact.id}`))}  ${chalk.dim("delete this contact")}\n`);
      process.stderr.write("\n");
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to show contact");
    }
  });
