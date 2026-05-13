// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { replCmd } from "../../lib/confirm.js";
import { resolveCompany } from "../../lib/resolve-company.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";

export const contactsShowCommand = new Command("show")
  .description("Show contact details")
  .argument("<id>", "Contact ID")
  .option("--company <id|name>", "Owning company ID or name (required)")
  .addHelpText(
    "after",
    `
Examples:
  pax8 contacts show contact-summit-001 --company "Summit Healthcare Partners"
  pax8 contacts show contact-summit-001 --company a1b2c3d4 --json
  pax8 contacts show contact-summit-001 --company a1b2c3d4 --csv

Notes:
  Contacts in the Pax8 public API are addressed only under their owning
  company (\`GET /v1/companies/{companyId}/contacts/{contactId}\`). The
  \`--company\` flag is required; there is no flat lookup endpoint.`
  )
  .action(async (id, _options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching contact...");

    try {
      if (!globalOpts.company) {
        throw new CliError(
          "--company is required",
          [
            "Contacts in v2 must be addressed under a company. Pass `--company <id|name>`.",
            "(Previously: `pax8 contacts show <contact-id>`.)",
          ],
          [
            `Pick a client first: ${replCmd("pax8 clients list")}`,
            `Then: ${replCmd(`pax8 contacts show ${id}`)} --company <id|name>`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      spinner.start();
      const company = await resolveCompany(ctx, globalOpts.company);
      const contact = await ctx.api.contacts.get(company.id, id);
      spinner.stop();

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(contact, null, 2) + "\n");
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
          {
            key: "types",
            header: "Types",
            // `types` is `Array<{type, primary}>` per the spec (#325). Flatten
            // to `Kind:primary` pairs so a CSV consumer doesn't lose the
            // `primary` bit. Defensive on the legacy string shape.
            format: (v: unknown) =>
              Array.isArray(v)
                ? v
                    .map((entry) => {
                      if (typeof entry === "string") return entry;
                      if (entry && typeof entry === "object" && "type" in entry) {
                        const e = entry as { type: string; primary?: boolean };
                        return `${e.type}:${e.primary ? "true" : "false"}`;
                      }
                      return String(entry);
                    })
                    .join("|")
                : String(v ?? ""),
          },
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
      // `contact.types` is `Array<{type, primary}>` per the public spec
      // (#325). Render as kind names with a `*` after any entry marked
      // primary, to surface the spec's `primary` bit in the human view.
      {
        const typesDisplay = (contact.types ?? [])
          .map((t) => (t.primary ? `${t.type}*` : t.type))
          .join(", ");
        process.stdout.write(`  ${chalk.dim("Types:".padEnd(14))}${typesDisplay || "—"}\n`);
      }
      process.stdout.write(`  ${chalk.dim("Company ID:".padEnd(14))}${contact.companyId}\n`);
      process.stdout.write("\n");

      // Pickable next steps. `contacts update` needs a new value the user
      // has to provide (email, name, etc.), so it can't be drilled into by
      // number — surfaced as an affordance pointer below the pickable list.
      const steps: NextStep[] = [
        {
          key: "1",
          label: `${chalk.cyan(replCmd(`pax8 contacts list --company "${company.name}"`))}  ${chalk.dim("see all contacts at this client")}`,
          command: ["contacts", "list", "--company", company.name],
        },
        {
          key: "2",
          label: `${chalk.cyan(replCmd(`pax8 clients more "${company.name}"`))}  ${chalk.dim("view client summary")}`,
          command: ["clients", "more", company.name],
        },
        {
          key: "3",
          label: `${chalk.cyan(replCmd(`pax8 contacts delete ${contact.id} --company "${company.name}"`))}  ${chalk.dim("delete this contact")}`,
          command: ["contacts", "delete", String(contact.id), "--company", company.name],
        },
      ];
      process.stderr.write(chalk.dim("  Try next:\n"));
      await promptNextSteps(steps, { renderList: true });
      process.stderr.write(
        chalk.dim(
          `  Update this contact — run ${chalk.cyan(replCmd("pax8 contacts update --help"))} for syntax.\n\n`,
        ),
      );
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to show contact");
    }
  });
