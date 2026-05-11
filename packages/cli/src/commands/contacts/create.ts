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
import type { CreateContactInput, ContactType } from "@pax8/core";

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

export const contactsCreateCommand = new Command("create")
  .description("Create a new contact for a company")
  .requiredOption("--company <id|name>", "Company ID or name (required)")
  .requiredOption("--email <email>", "Contact email (required)")
  .requiredOption("--first-name <name>", "First name (required)")
  .requiredOption("--last-name <name>", "Last name (required)")
  .option("--phone <phone>", "Phone number")
  .option("--type <types>", "Comma-separated contact types: Admin, Billing, Technical", "Admin")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 contacts create --company "Summit Healthcare Partners" --email rachel@example.com --first-name Rachel --last-name Thornton
  pax8 contacts create --company a1b2c3d4 --email tech@example.com --first-name Sam --last-name Lee --type Technical
  pax8 contacts create --company a1b2c3d4 --email ops@example.com --first-name Pat --last-name Kim --type Admin,Billing

Notes:
  Contacts in the Pax8 public API are addressed only under their owning
  company (\`POST /v1/companies/{companyId}/contacts\`). The \`--company\`
  flag is required; there is no flat create endpoint.`
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);

    try {
      const parsed = parseTypes(String(options.type));
      if (parsed.length === 0) {
        throw new CliError(
          "At least one contact type is required",
          [`--type must contain one or more comma-separated values from: ${VALID_TYPES.join(", ")}`],
          [`Try: ${replCmd("pax8 contacts create")} --type Admin,Billing ...`],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }
      const invalid = parsed.filter((t) => !VALID_TYPES.includes(t as ContactType));
      if (invalid.length > 0) {
        throw new CliError(
          `Invalid --type value(s): ${invalid.map((v) => `"${v}"`).join(", ")}`,
          [`Allowed values: ${VALID_TYPES.join(", ")}`],
          [`Try: ${replCmd("pax8 contacts create")} --type Admin,Billing ...`],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }
      const types = parsed as ContactType[];

      const company = await resolveCompany(ctx, options.company);

      // Show preview
      process.stderr.write(chalk.bold("\n  New Contact:\n\n"));
      process.stderr.write(`  ${chalk.dim("Name:".padEnd(14))}${options.firstName} ${options.lastName}\n`);
      process.stderr.write(`  ${chalk.dim("Email:".padEnd(14))}${options.email}\n`);
      if (options.phone) {
        process.stderr.write(`  ${chalk.dim("Phone:".padEnd(14))}${options.phone}\n`);
      }
      process.stderr.write(`  ${chalk.dim("Types:".padEnd(14))}${types.join(", ")}\n`);
      process.stderr.write(`  ${chalk.dim("Company:".padEnd(14))}${company.name}\n\n`);

      const ok = await confirm("Create this contact?", { default: true });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const input: CreateContactInput = {
        firstName: options.firstName,
        lastName: options.lastName,
        email: options.email,
        companyId: company.id,
        types,
        ...(options.phone ? { phone: options.phone } : {}),
      };

      const spinner = createSpinner("Creating contact...").start();
      const doneCreate = markWriteInFlight("contacts");
      let contact;
      try {
        contact = await ctx.api.contacts.create(company.id, input);
      } finally {
        doneCreate();
      }
      await invalidateCacheAfterWrite();
      spinner.succeed("Contact created");

      if (ctx.outputFormat === "json") {
        output([contact], { format: "json" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("Contact ID:".padEnd(14))}${contact.id}\n`);
      process.stdout.write(`  ${chalk.dim("Name:".padEnd(14))}${contact.firstName} ${contact.lastName}\n`);
      process.stdout.write(`  ${chalk.dim("Email:".padEnd(14))}${contact.email}\n`);
      process.stdout.write(`  ${chalk.dim("Types:".padEnd(14))}${(contact.types ?? []).join(", ")}\n`);
      process.stdout.write("\n");

      process.stderr.write(chalk.dim("  Try next:\n"));
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 contacts list --company "${company.name}"`))}  ${chalk.dim("view all contacts at this company")}\n`);
      process.stderr.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to create contact");
    }
  });
