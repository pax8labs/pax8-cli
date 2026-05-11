// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { confirm, replCmd } from "../../lib/confirm.js";
import { resolveCompany } from "../../lib/resolve-company.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";
import type { UpdateContactInput, ContactType } from "@pax8/core";

const VALID_TYPES: ContactType[] = ["Admin", "Billing", "Technical"];

function parseTypes(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export const contactsUpdateCommand = new Command("update")
  .description("Update a contact")
  .argument("<id>", "Contact ID")
  .option("--company <id|name>", "Owning company ID or name (required)")
  .option("--first-name <name>", "New first name")
  .option("--last-name <name>", "New last name")
  .option("--email <email>", "New email")
  .option("--phone <phone>", "New phone number")
  .option("--type <types>", "Comma-separated contact types: Admin, Billing, Technical")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 contacts update contact-summit-001 --company "Summit Healthcare Partners" --email rachel.new@example.com
  pax8 contacts update contact-summit-001 --company a1b2c3d4 --type Billing
  pax8 contacts update contact-summit-001 --company a1b2c3d4 --type Admin,Billing
  pax8 contacts update contact-summit-001 --company a1b2c3d4 --phone "+1-303-555-9999" --yes

Notes:
  Contacts in the Pax8 public API are addressed only under their owning
  company (\`PUT /v1/companies/{companyId}/contacts/{contactId}\`). The
  \`--company\` flag is required; there is no flat update endpoint.`
  )
  .action(async (id, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);

    try {
      if (!globalOpts.company) {
        throw new CliError(
          "--company is required",
          [
            "Contacts in v2 must be addressed under a company. Pass `--company <id|name>`.",
            "(Previously: `pax8 contacts update <contact-id> ...`.)",
          ],
          [
            `Pick a company first: ${replCmd("pax8 companies list")}`,
            `Then: ${replCmd(`pax8 contacts update ${id}`)} --company <id|name> --email <new-email>`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      const data: UpdateContactInput = {};
      if (options.firstName) data.firstName = options.firstName;
      if (options.lastName) data.lastName = options.lastName;
      if (options.email) data.email = options.email;
      if (options.phone) data.phone = options.phone;
      if (options.type !== undefined) {
        const parsed = parseTypes(String(options.type));
        if (parsed.length === 0) {
          throw new CliError(
            "At least one contact type is required when --type is provided",
            [`--type must contain one or more comma-separated values from: ${VALID_TYPES.join(", ")}`],
            [`Try: ${replCmd("pax8 contacts update")} ${id} --company <id|name> --type Admin,Billing`],
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
        const invalid = parsed.filter((t) => !VALID_TYPES.includes(t as ContactType));
        if (invalid.length > 0) {
          throw new CliError(
            `Invalid --type value(s): ${invalid.map((v) => `"${v}"`).join(", ")}`,
            [`Allowed values: ${VALID_TYPES.join(", ")}`],
            [`Try: ${replCmd("pax8 contacts update")} ${id} --company <id|name> --type Admin,Billing`],
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
        data.types = parsed as ContactType[];
      }

      if (Object.keys(data).length === 0) {
        throw new CliError(
          "No fields to update",
          ["At least one of --first-name, --last-name, --email, --phone, or --type is required"],
          [`Try: ${replCmd("pax8 contacts update")} ${id} --company <id|name> --email <new-email>`],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      const spinner = createSpinner("Fetching contact...").start();
      const company = await resolveCompany(ctx, globalOpts.company);
      const current = await ctx.api.contacts.get(company.id, id);
      spinner.stop();

      process.stderr.write(chalk.bold("\n  Update Contact:\n\n"));
      process.stderr.write(`  ${chalk.dim("ID:".padEnd(14))}${current.id}\n`);
      process.stderr.write(`  ${chalk.dim("Current:".padEnd(14))}${current.firstName} ${current.lastName} <${current.email}>\n\n`);
      for (const [k, v] of Object.entries(data)) {
        const label = k === "types" ? "types" : k;
        const display = Array.isArray(v) ? v.join(", ") : String(v);
        process.stderr.write(`  ${chalk.dim((label + ":").padEnd(14))}${chalk.green(display)}\n`);
      }
      process.stderr.write("\n");

      const ok = await confirm("Apply these changes?", { default: true });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const updateSpinner = createSpinner("Updating contact...").start();
      const doneUpdate = markWriteInFlight("contacts");
      let updated;
      try {
        updated = await ctx.api.contacts.update(company.id, id, data);
      } finally {
        doneUpdate();
      }
      await invalidateCacheAfterWrite();
      updateSpinner.succeed("Contact updated");

      if (ctx.outputFormat === "json") {
        output([updated], { format: "json" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("ID:".padEnd(14))}${updated.id}\n`);
      process.stdout.write(`  ${chalk.dim("Name:".padEnd(14))}${updated.firstName} ${updated.lastName}\n`);
      process.stdout.write(`  ${chalk.dim("Email:".padEnd(14))}${updated.email}\n`);
      if (updated.phone) {
        process.stdout.write(`  ${chalk.dim("Phone:".padEnd(14))}${updated.phone}\n`);
      }
      process.stdout.write(`  ${chalk.dim("Types:".padEnd(14))}${(updated.types ?? []).join(", ")}\n`);
      process.stdout.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to update contact");
    }
  });
