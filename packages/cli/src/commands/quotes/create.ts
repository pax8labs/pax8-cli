// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { confirm, replCmd } from "../../lib/confirm.js";
import { resolveCompany } from "../../lib/resolve-company.js";
import { resolveProduct } from "../../lib/resolve-product.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";
import { formatQuantity } from "../../lib/formatters.js";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import type { CreateQuoteInput, BillingTerm } from "@pax8/core";

export const quotesCreateCommand = new Command("create")
  .description("Create a new quote with a single line item")
  .requiredOption("--company <id|name>", "Company ID or name (required)")
  .requiredOption("--product <id|name>", "Product ID or name (required)")
  .option("--quantity <number>", "Quantity", "1")
  .option("--billing-term <term>", "Billing term (Monthly or Annual)", "Monthly")
  .option("--expiration-date <date>", "Quote expiration date (YYYY-MM-DD)")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 quotes create --company "Summit Healthcare Partners" --product "Microsoft 365 E3" --quantity 10
  pax8 quotes create --company a1b2c3d4 --product prod-m365-e3-0003 --quantity 5 --billing-term Annual`
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);

    try {
      const quantity = parseInt(options.quantity, 10);
      if (isNaN(quantity) || quantity <= 0) {
        throw new CliError(
          `Invalid quantity: "${options.quantity}"`,
          ["Quantity must be a positive integer"],
          undefined,
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      const company = await resolveCompany(ctx, options.company);
      const product = await resolveProduct(ctx, options.product);

      process.stderr.write(chalk.bold("\n  New Quote:\n\n"));
      process.stderr.write(`  ${chalk.dim("Company:".padEnd(18))}${company.name}\n`);
      process.stderr.write(`  ${chalk.dim("Product:".padEnd(18))}${product.name}\n`);
      process.stderr.write(`  ${chalk.dim("Quantity:".padEnd(18))}${formatQuantity(quantity)}\n`);
      process.stderr.write(`  ${chalk.dim("Billing Term:".padEnd(18))}${options.billingTerm}\n`);
      if (options.expirationDate) {
        process.stderr.write(`  ${chalk.dim("Expires:".padEnd(18))}${options.expirationDate}\n`);
      }
      process.stderr.write("\n");

      const ok = await confirm("Create this quote?", { default: true });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const input: CreateQuoteInput = {
        companyId: company.id,
        lineItems: [
          {
            productId: product.id,
            quantity,
            billingTerm: options.billingTerm as BillingTerm,
          },
        ],
      };

      const spinner = createSpinner("Creating quote...").start();
      const doneCreate = markWriteInFlight("quotes");
      let quote;
      try {
        quote = await ctx.api.quotes.create(input);
      } finally {
        doneCreate();
      }
      await invalidateCacheAfterWrite();
      spinner.succeed("Quote created");

      if (ctx.outputFormat === "json") {
        output([quote as unknown as Record<string, unknown>], { format: "json" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("Quote ID:".padEnd(14))}${quote.id}\n`);
      process.stdout.write(`  ${chalk.dim("Status:".padEnd(14))}${quote.status}\n`);
      process.stdout.write(`  ${chalk.dim("Company:".padEnd(14))}${company.name}\n`);
      process.stdout.write(`  ${chalk.dim("Product:".padEnd(14))}${product.name}\n`);
      process.stdout.write(`  ${chalk.dim("Quantity:".padEnd(14))}${formatQuantity(quantity)}\n`);
      process.stdout.write("\n");

      process.stderr.write(chalk.dim("  Try next:\n"));
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 quotes show ${quote.id}`))}  ${chalk.dim("view quote details")}\n`);
      process.stderr.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to create quote");
    }
  });
