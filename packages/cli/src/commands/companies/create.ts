// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT, type CreateCompanyInput } from "@pax8/core";
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

export const companiesCreateCommand = new Command("create")
  .description("Create a new company")
  .requiredOption("--name <name>", "Company name (required)")
  .option("--phone <phone>", "Company phone number")
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
    "false"
  )
  .option(
    "--self-service-allowed <true|false>",
    "Customer can self-service via the marketplace (defaults to false)",
    "false"
  )
  .option(
    "--order-approval-required <true|false>",
    "Orders require partner approval (defaults to false)",
    "false"
  )
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 companies create --name "Summit Healthcare Partners" --phone "+1-303-555-0101" --website "https://summithealthcare.example.com" --city Denver --state CO --zip 80246
  pax8 companies create --name "Test Co" --city Denver --state CO --zip 80202 --country US --bill-on-behalf-of true
  pax8 companies create --name "Approval Co" --city NYC --state NY --zip 10001 --order-approval-required true --yes`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    try {
      const ctx = await buildContext(allOpts);

      // Spec requires a non-empty address on `POST /companies`. Fail-fast
      // with a structured error rather than silently shipping a degenerate
      // empty address object on the wire (#329).
      const hasAddress = Boolean(
        allOpts.street || allOpts.city || allOpts.state || allOpts.zip
      );
      if (!hasAddress) {
        throw new CliError(
          "Address is required to create a company",
          ["The Pax8 spec marks `address` as a required field on POST /companies."],
          [
            "Pass at least one of --street, --city, --state, --zip (and --country if not US).",
            "Example: pax8 companies create --name \"Acme\" --city Denver --state CO --zip 80202",
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
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
      };

      const doneCreate = markWriteInFlight("companies");
      let company;
      try {
        company = await ctx.api.companies.create(payload);
      } finally {
        doneCreate();
      }

      await invalidateCacheAfterWrite();
      spinner.succeed("Company created 🎉");

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
