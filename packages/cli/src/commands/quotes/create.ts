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
import {
  resolveEffectiveDate,
  resolveListPrice,
} from "../../lib/quote-line-item-defaults.js";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import type {
  CreateQuoteInput,
  AddQuoteLineItemInput,
  BillingTerm,
} from "@pax8/core";

export const quotesCreateCommand = new Command("create")
  .description("Create a new quote (empty, or with a single line item via --product)")
  .requiredOption("--company <id|name>", "Company ID or name (required)")
  .option("--product <id|name>", "Optional product ID or name. When set, a single line item is appended after the quote is created.")
  .option("--quantity <number>", "Quantity (only meaningful with --product)", "1")
  .option(
    "--billing-term <term>",
    "Billing term (Monthly or Annual; only meaningful with --product)",
    "Monthly",
  )
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Body shape (POST /v2/quotes):
  The v2 quoting API accepts only { clientId, quoteRequestId? } on create.
  Line items are added via a separate POST /v2/quotes/{id}/line-items call.
  Passing --product orchestrates both steps for you; without it, an empty
  draft quote is created (the natural shape for the v2 surface).

Examples:
  # Empty quote — canonical v2 shape. Add line items separately.
  pax8 quotes create --company "Summit Healthcare Partners"
  pax8 quotes line-items add <quote-id> --product "Microsoft 365 E3" --quantity 10

  # Shorthand: create quote + add a single line item in one command.
  pax8 quotes create --company "Summit Healthcare Partners" --product "Microsoft 365 E3" --quantity 10
  pax8 quotes create --company a1b2c3d4 --product prod-m365-e3-0003 --quantity 5 --billing-term Annual

Setting an expiration date:
  POST /v2/quotes does not accept an expiration date. To set or change a
  quote's expiration, follow up with:
    pax8 quotes update <id> --expiration-date <YYYY-MM-DD>`,
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);

    try {
      // Quantity is only meaningful when --product is supplied, but if either
      // is set we validate the integer up-front so the user sees the error
      // before the company-resolve round trip.
      const hasProduct = typeof options.product === "string" && options.product.length > 0;
      const quantity = hasProduct ? parseInt(options.quantity, 10) : undefined;
      if (hasProduct && (quantity === undefined || isNaN(quantity) || quantity <= 0)) {
        throw new CliError(
          `Invalid quantity: "${options.quantity}"`,
          ["Quantity must be a positive integer"],
          undefined,
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      const company = await resolveCompany(ctx, options.company);
      const product = hasProduct ? await resolveProduct(ctx, options.product) : undefined;

      process.stderr.write(chalk.bold("\n  New Quote:\n\n"));
      process.stderr.write(`  ${chalk.dim("Company:".padEnd(18))}${company.name}\n`);
      if (product && quantity !== undefined) {
        process.stderr.write(`  ${chalk.dim("Product:".padEnd(18))}${product.name}\n`);
        process.stderr.write(`  ${chalk.dim("Quantity:".padEnd(18))}${formatQuantity(quantity)}\n`);
        process.stderr.write(`  ${chalk.dim("Billing Term:".padEnd(18))}${options.billingTerm}\n`);
      } else {
        process.stderr.write(`  ${chalk.dim("Line items:".padEnd(18))}${chalk.dim("(none — add with `quotes line-items add`)")}\n`);
      }
      process.stderr.write("\n");

      const ok = await confirm("Create this quote?", { default: true });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const createInput: CreateQuoteInput = { clientId: company.id };

      const createSpin = createSpinner("Creating quote...").start();
      const doneCreate = markWriteInFlight("quotes");
      let quote;
      try {
        quote = await ctx.api.quotes.create(createInput);
      } catch (err) {
        doneCreate();
        throw err;
      }
      doneCreate();
      createSpin.succeed("Quote created");

      // Two-call orchestration for the shorthand path. If the line-item POST
      // fails the quote is already created server-side — surface the new ID
      // prominently with a recovery hint so the user can retry the add
      // manually instead of losing the quote.
      if (product && quantity !== undefined) {
        const billingTerm = options.billingTerm as BillingTerm;
        // The v2 line-items POST requires `effectiveDate` and `price` per
        // #312. The shorthand uses sensible defaults: today (UTC) and the
        // product's `suggestedRetailPrice` for the chosen billing term.
        // Partners needing custom pricing or a different effective date can
        // create the empty quote and use `pax8 quotes line-items add` with
        // the explicit `--price` / `--effective-date` flags.
        const effectiveDate = resolveEffectiveDate(undefined);
        const price = await resolveListPrice(ctx, product.id, billingTerm);
        if (price === undefined) {
          throw new CliError(
            `No list price available for ${product.name} (${billingTerm})`,
            [
              "The shorthand needs a default price to populate the line item.",
              `Try: pax8 quotes create --company "${options.company}" (creates empty quote),`,
              `then: pax8 quotes line-items add <quote-id> --product "${options.product}" --quantity ${quantity} --price <number>`,
            ],
            undefined,
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
        const lineInput: AddQuoteLineItemInput = {
          productId: product.id,
          quantity,
          billingTerm,
          effectiveDate,
          price,
        };
        const lineSpin = createSpinner("Adding line item...").start();
        const doneLine = markWriteInFlight("quotes");
        try {
          quote = await ctx.api.quotes.addLineItem(quote.id, lineInput);
          doneLine();
          lineSpin.succeed("Line item added");
        } catch (err) {
          doneLine();
          lineSpin.fail("Line item add failed");

          // Quote create succeeded — surface the ID prominently so the user
          // can recover, then re-throw so the error envelope/exit-code path
          // still fires. Partial-failure recovery hint per #311.
          const recoveryCmd = `pax8 quotes line-items add ${quote.id} --product ${options.product} --quantity ${quantity}`;
          process.stderr.write(
            chalk.yellow(
              `\n  ⚠ Quote ${chalk.bold(quote.id)} was created but the line-item add failed.\n`,
            ),
          );
          process.stderr.write(chalk.yellow("  Recover with:\n"));
          process.stderr.write(
            `    ${chalk.cyan(replCmd(recoveryCmd))}\n\n`,
          );

          await invalidateCacheAfterWrite();
          throw err;
        }
      }

      await invalidateCacheAfterWrite();

      if (ctx.outputFormat === "json") {
        output([quote], { format: "json" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("Quote ID:".padEnd(14))}${quote.id}\n`);
      process.stdout.write(`  ${chalk.dim("Status:".padEnd(14))}${quote.status}\n`);
      process.stdout.write(`  ${chalk.dim("Company:".padEnd(14))}${company.name}\n`);
      if (product && quantity !== undefined) {
        process.stdout.write(`  ${chalk.dim("Product:".padEnd(14))}${product.name}\n`);
        process.stdout.write(`  ${chalk.dim("Quantity:".padEnd(14))}${formatQuantity(quantity)}\n`);
      } else {
        process.stdout.write(`  ${chalk.dim("Line items:".padEnd(14))}0\n`);
      }
      process.stdout.write("\n");

      process.stderr.write(chalk.dim("  Try next:\n"));
      if (!product) {
        process.stderr.write(
          `    ${chalk.cyan(replCmd(`pax8 quotes line-items add ${quote.id} --product <id|name> --quantity <n>`))}  ${chalk.dim("add a line item")}\n`,
        );
      }
      process.stderr.write(
        `    ${chalk.cyan(replCmd(`pax8 quotes show ${quote.id}`))}  ${chalk.dim("view quote details")}\n`,
      );
      process.stderr.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to create quote");
    }
  });
