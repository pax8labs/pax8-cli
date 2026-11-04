// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import {
  ERROR_INVALID_INPUT,
  type CreateCompanyInput,
  type CreateCompanyContactInput,
} from "@pax8/core";
import { createSpinner } from "../../lib/spinner.js";
import { CliError, handleCommandError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { confirm } from "../../lib/confirm.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";

/**
 * Commander hands us boolean-ish flags as the string Commander parsed
 * (`"true"`, `"false"`) or the default. Coerce defensively — any value that
 * isn't literally `"true"` (case-insensitive) becomes `false`.
 */
function parseBool(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return defaultValue;
}

/**
 * Build the atomic-create contact payload from the four required contact
 * flags. Implicitly sets `primary: true` on all three ContactType values
 * (Admin, Billing, Technical) per the Pax8 API Reference: "one contact
 * with all three types and marked as primary for each type is sufficient"
 * for activation. The common case for the atomic path is one human runs
 * the new company; requiring partners to enumerate three types adds
 * verbosity without value. Partners needing separate contacts per type
 * can use `pax8 contacts create` after creation. See #330.
 */
function buildPrimaryContact(
  firstName: string,
  lastName: string,
  email: string,
  phone: string,
): CreateCompanyContactInput {
  return {
    firstName,
    lastName,
    email,
    phone,
    types: [
      { type: "Admin", primary: true },
      { type: "Billing", primary: true },
      { type: "Technical", primary: true },
    ],
  };
}

export const companiesCreateCommand = new Command("create")
  .description("Create a new client (Active by default via atomic contact creation)")
  .requiredOption("--name <name>", "Company name (required)")
  .option("--phone <phone>", "Company phone number (also used as the primary-contact phone on the default atomic path)")
  .option("--website <url>", "Company website")
  .option("--street <street>", "Street address")
  .option("--city <city>", "City")
  .option("--state <state>", "State or province (maps to address.stateOrProvince on the wire)")
  .option("--zip <zip>", "Postal code (maps to address.postalCode on the wire)")
  .option("--country <country>", "Country code (e.g. US)", "US")
  // Three spec-required billing booleans (`#329`). Defaults match the
  // conservative shape in the OpenAPI `company-post` example: every flag
  // off. Partners who need a different posture pass the flag explicitly.
  .option(
    "--bill-on-behalf-of <true|false>",
    "Pax8 bills the customer on the partner's behalf (defaults to false)",
    "false",
  )
  .option(
    "--self-service-allowed <true|false>",
    "Customer can self-service via the marketplace (defaults to false)",
    "false",
  )
  .option(
    "--order-approval-required <true|false>",
    "Orders require partner approval (defaults to false)",
    "false",
  )
  // Atomic-path contact flags (#330). Required on the default path; ignored
  // on `--company-only`. The same `--phone` value is sent as both the
  // company phone and the contact phone — partners who need different
  // phones can use `--company-only` then `pax8 contacts create`.
  .option("--first-name <name>", "Primary contact first name (required unless --company-only)")
  .option("--last-name <name>", "Primary contact last name (required unless --company-only)")
  .option("--email <email>", "Primary contact email (required unless --company-only)")
  // `--company-only` opt-out
  .option(
    "--company-only",
    "Skip the atomic contact payload. Creates an Inactive company. See warning in --help.",
  )
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Atomic-create behavior (default):
  Per the Pax8 API Reference, POST /companies accepts an optional
  contacts: [...] array. Including a properly-typed primary contact
  flips the new company from Inactive to Active at creation. The CLI builds
  the contact from --first-name, --last-name, --email, and --phone, and
  implicitly marks it as primary:true for all three ContactType values
  (Admin, Billing, Technical) per the spec's activation rule.

  The contact phone uses the same --phone value as the company phone. If
  the contact phone needs to differ, use --company-only and then add the
  contact separately via 'pax8 contacts create' with the desired --phone.

--company-only (opt-out, Inactive company):
  Creates the company without the contacts array. The company will be
  Inactive — won't appear in the portal, won't support orders or
  subscriptions, and blocks re-creation with "already exists" until
  primary contacts are added via 'pax8 contacts create'.

Examples:
  # Atomic (Active company in one call)
  pax8 clients create --name "Summit Healthcare" --phone "+1-303-555-0101" \\
      --website "https://summithealthcare.example.com" --city Denver --state CO --zip 80246 \\
      --first-name Maya --last-name Chen --email maya@summit.example.com

  # Company-only (Inactive — must follow up with 'pax8 contacts create')
  pax8 clients create --name "Test Co" --city Denver --state CO --zip 80202 --company-only

Note:
  The contact you provide is assigned as primary Admin, Billing, and Technical
  to activate the company. To split these roles to different contacts, use
  'pax8 contacts update' or create additional contacts with
  'pax8 contacts create --type' after company creation.`,
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const companyOnly = Boolean(allOpts.companyOnly);

    try {
      const ctx = await buildContext(allOpts);

      // Spec requires a non-empty address on `POST /companies`. Fail-fast
      // with a structured error rather than silently shipping a degenerate
      // empty address object on the wire (#329).
      const hasAddress = Boolean(
        allOpts.street || allOpts.city || allOpts.state || allOpts.zip,
      );
      if (!hasAddress) {
        throw new CliError(
          "Address is required to create a company",
          ["The Pax8 spec marks `address` as a required field on POST /companies."],
          [
            "Pass at least one of --street, --city, --state, --zip (and --country if not US).",
            'Example: pax8 clients create --name "Acme" --city Denver --state CO --zip 80202',
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      // Atomic-path contact validation — only required when --company-only is NOT set.
      // The four contact flags map to the API's required scalars on
      // CreateCompanyContactInputSchema; --phone is shared with the company.
      if (!companyOnly) {
        const missing: string[] = [];
        if (!allOpts.firstName) missing.push("--first-name");
        if (!allOpts.lastName) missing.push("--last-name");
        if (!allOpts.email) missing.push("--email");
        if (!allOpts.phone) missing.push("--phone");
        if (missing.length > 0) {
          throw new CliError(
            `Missing required contact flag(s): ${missing.join(", ")}`,
            [
              "POST /companies accepts an optional contacts[] array; the default atomic-create path requires the four contact scalars to construct a primary contact that activates the company.",
              "Per the Pax8 companies API: companies created without a primary Admin/Billing/Technical contact are Inactive and unusable.",
            ],
            [
              'Pass --first-name, --last-name, --email, --phone (e.g. --first-name Maya --last-name Chen --email maya@example.com --phone "+1-303-555-0101")',
              "Or pass --company-only to skip the atomic path (creates an Inactive company — see --help for caveats).",
            ],
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
      }

      const billOnBehalfOfEnabled = parseBool(allOpts.billOnBehalfOf, false);
      const selfServiceAllowed = parseBool(allOpts.selfServiceAllowed, false);
      const orderApprovalRequired = parseBool(allOpts.orderApprovalRequired, false);

      // Show what will be created
      process.stderr.write(chalk.bold("\n  Creating company:\n\n"));
      process.stderr.write(`  ${chalk.dim("Name:")}     ${allOpts.name}\n`);
      if (allOpts.phone) process.stderr.write(`  ${chalk.dim("Phone:")}    ${allOpts.phone}\n`);
      if (allOpts.website) process.stderr.write(`  ${chalk.dim("Website:")}  ${allOpts.website}\n`);
      const addrParts = [allOpts.street, allOpts.city, allOpts.state, allOpts.zip].filter(Boolean);
      process.stderr.write(`  ${chalk.dim("Location:")} ${addrParts.join(", ")} ${allOpts.country}\n`);
      process.stderr.write(`  ${chalk.dim("Bill-on-behalf-of:")} ${billOnBehalfOfEnabled}\n`);
      process.stderr.write(`  ${chalk.dim("Self-service:")}      ${selfServiceAllowed}\n`);
      process.stderr.write(`  ${chalk.dim("Order approval:")}    ${orderApprovalRequired}\n`);

      if (companyOnly) {
        // Verbatim warning text per #330. The wording matters — agents and
        // partners reading this need to know exactly what state the company
        // ends up in and how to recover.
        process.stderr.write("\n");
        process.stderr.write(chalk.yellow.bold("  ⚠️  Creating company WITHOUT primary contacts.\n\n"));
        process.stderr.write(chalk.yellow("  This company will be created in Inactive state. It:\n"));
        process.stderr.write(chalk.yellow("    - Will NOT appear in the Pax8 portal\n"));
        process.stderr.write(chalk.yellow("    - Will NOT support orders, subscriptions, or quotes\n"));
        process.stderr.write(chalk.yellow('    - Will block re-creation with "already exists" until primary contacts are added\n\n'));
        process.stderr.write(chalk.yellow("  To activate, add contacts via:\n"));
        process.stderr.write(chalk.yellow("      pax8 contacts create --company <id> --first-name X --last-name Y --email Z --phone W --type Admin,Billing,Technical\n\n"));
        process.stderr.write(chalk.yellow("  Or omit --company-only on this command to add primary contacts atomically.\n"));
      } else {
        process.stderr.write(`  ${chalk.dim("Primary contact:")}    ${allOpts.firstName} ${allOpts.lastName} <${allOpts.email}>\n`);
        process.stderr.write(`  ${chalk.dim("Contact types:")}       Admin, Billing, Technical (all primary)\n`);
      }
      process.stderr.write("\n");

      const confirmed = await confirm("Create this company?", { default: true });
      if (!confirmed) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Creating company...").start();

      // Wire mapping: the user-facing CLI flag names `--state` / `--zip`
      // intentionally stay as-is (see `docs/UX_GUIDE.md` and the vocabulary
      // mapping table in `docs/domain-review.md`). The wire field names are
      // `stateOrProvince` / `postalCode` per the public Pax8 OpenAPI spec.
      const payload: CreateCompanyInput = {
        name: allOpts.name,
        phone: allOpts.phone || "",
        website: allOpts.website || "",
        address: {
          street: allOpts.street || "",
          city: allOpts.city || "",
          stateOrProvince: allOpts.state || "",
          postalCode: allOpts.zip || "",
          country: allOpts.country || "US",
        },
        billOnBehalfOfEnabled,
        selfServiceAllowed,
        orderApprovalRequired,
        // Atomic-create: include the contacts array only on the default
        // path. Omitting the field entirely (not sending an empty array) on
        // `--company-only` keeps the request body identical to the pre-#330
        // shape that produces an Inactive company.
        ...(companyOnly
          ? {}
          : {
              contacts: [
                buildPrimaryContact(
                  allOpts.firstName,
                  allOpts.lastName,
                  allOpts.email,
                  allOpts.phone,
                ),
              ],
            }),
      };

      const doneCreate = markWriteInFlight("companies");
      let company;
      try {
        company = await ctx.api.companies.create(payload);
      } finally {
        doneCreate();
      }

      await invalidateCacheAfterWrite();
      spinner.succeed(companyOnly ? "Company created (Inactive — add contacts to activate)" : "Company created 🎉");

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(company, null, 2) + "\n");
        return;
      }

      process.stdout.write("\n");
      process.stdout.write(chalk.bold(`  ${company.name}\n\n`));
      process.stdout.write(`  ${chalk.dim("ID:")}       ${company.id}\n`);
      process.stdout.write(`  ${chalk.dim("Status:")}   ${company.status}\n`);
      process.stdout.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to create company");
    }
  });
