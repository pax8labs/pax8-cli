// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../../lib/context.js";
import { output } from "../../../lib/output.js";
import { createSpinner } from "../../../lib/spinner.js";
import { handleCommandError, CliError } from "../../../lib/errors.js";
import { confirm, replCmd } from "../../../lib/confirm.js";
import { resolveProduct } from "../../../lib/resolve-product.js";
import { invalidateCacheAfterWrite } from "../../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../../lib/signals.js";
import { formatQuantity, formatCurrency as formatPrice } from "../../../lib/formatters.js";
import {
  ERROR_INVALID_INPUT,
  type BillingTerm,
  type AddQuoteLineItemInput,
} from "@pax8/core";
import {
  resolveEffectiveDate,
  resolveListPrice,
} from "../../../lib/quote-line-item-defaults.js";

// `resolveEffectiveDate` and `resolveListPrice` moved to
// `packages/cli/src/lib/quote-line-item-defaults.ts` so #311's `quotes create`
// two-call orchestration can reuse the same defaults.

export const quotesLineItemsAddCommand = new Command("add")
  .description("Add a line item to a quote")
  .argument("<quote-id>", "Quote ID")
  .requiredOption("--product <id|name>", "Product ID or name (required)")
  .option("--quantity <number>", "Quantity", "1")
  .option("--billing-term <term>", "Billing term (Monthly or Annual)", "Monthly")
  .option(
    "--price <number>",
    "Per-unit price for the line (defaults to the product's list price for the chosen billing term)",
  )
  .option(
    "--effective-date <YYYY-MM-DD>",
    "Effective date for the line (defaults to today, UTC)",
  )
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 quotes line-items add quote-summit-001 --product "Microsoft 365 E3" --quantity 5
  pax8 quotes line-items add quote-summit-001 --product prod-aad-p1-0008 --quantity 5 --billing-term Annual
  pax8 quotes line-items add quote-summit-001 --product prod-m365-e3-0003 --quantity 5 --price 22.50
  pax8 quotes line-items add quote-summit-001 --product prod-m365-e3-0003 --quantity 5 --effective-date 2026-06-01
  pax8 quotes line-items add quote-summit-001 --product prod-m365-e3-0003 --quantity 5 --json --yes`,
  )
  .action(async (quoteId, options, command) => {
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

      // Resolve `--price` override if provided. Validate up-front so a bad
      // value fails before any network/IO work.
      let priceOverride: number | undefined;
      if (options.price !== undefined) {
        const parsed = Number(options.price);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new CliError(
            `Invalid price: "${options.price}"`,
            ["Price must be a non-negative number"],
            undefined,
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
        priceOverride = parsed;
      }

      // Resolve `--effective-date` override or default to today (UTC). The v2
      // spec requires an ISO 8601 date-time; we accept the friendlier
      // `YYYY-MM-DD` shape from the user and normalize to `T00:00:00Z`.
      const effectiveDate = resolveEffectiveDate(options.effectiveDate);

      const fetchSpinner = createSpinner("Fetching quote...").start();
      const quote = await ctx.api.quotes.get(quoteId);
      // Snapshot pre-state line-item IDs immediately. In demo mode the
      // mock mutates the same quote object, so a deferred diff would see
      // the post-mutation state and miss the new ID.
      const beforeIds = new Set(
        (quote.lineItems ?? []).map((li) => li.id).filter(Boolean) as string[],
      );
      fetchSpinner.stop();

      const product = await resolveProduct(ctx, options.product);

      // Resolve unit price: explicit `--price` wins; otherwise look up the
      // product's list price (`suggestedRetailPrice`) for the chosen
      // billing term. The lookup is best-effort and cached per command run,
      // matching the convention used by `orders create` (#312).
      const billingTerm = options.billingTerm as BillingTerm;
      const price = priceOverride
        ?? (await resolveListPrice(ctx, product.id, billingTerm));

      if (price === undefined) {
        throw new CliError(
          `No list price found for "${product.name}" at billing term "${billingTerm}"`,
          [
            `Pass --price <number> to set the per-unit price explicitly`,
            `Try a different --billing-term (Monthly or Annual)`,
          ],
          undefined,
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      process.stderr.write(chalk.bold("\n  Add line item:\n\n"));
      process.stderr.write(`  ${chalk.dim("Quote:".padEnd(18))}${quote.id} ${chalk.dim(`(${quote.status})`)}\n`);
      process.stderr.write(`  ${chalk.dim("Product:".padEnd(18))}${product.name}\n`);
      process.stderr.write(`  ${chalk.dim("Quantity:".padEnd(18))}${formatQuantity(quantity)}\n`);
      process.stderr.write(`  ${chalk.dim("Billing term:".padEnd(18))}${billingTerm}\n`);
      process.stderr.write(
        `  ${chalk.dim("Unit price:".padEnd(18))}${formatPrice(price)}${
          priceOverride !== undefined ? chalk.dim(" (override)") : chalk.dim(" (list)")
        }\n`,
      );
      process.stderr.write(
        `  ${chalk.dim("Effective date:".padEnd(18))}${effectiveDate.slice(0, 10)}\n`,
      );
      process.stderr.write(`  ${chalk.dim("Existing items:".padEnd(18))}${quote.lineItems?.length ?? 0}\n\n`);

      const ok = await confirm("Add this line item?", { default: true });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const input: AddQuoteLineItemInput = {
        productId: product.id,
        quantity,
        billingTerm,
        effectiveDate,
        price,
      };

      const spinner = createSpinner("Adding line item...").start();
      const done = markWriteInFlight("quotes");
      let updated;
      try {
        updated = await ctx.api.quotes.addLineItem(quoteId, input);
      } finally {
        done();
      }
      await invalidateCacheAfterWrite();
      spinner.succeed("Line item added");

      // Identify the newly added line item by diffing against the pre-state
      // snapshot taken before the POST.
      const newLine = (updated.lineItems ?? []).find(
        (li) => li.id && !beforeIds.has(li.id),
      );

      if (ctx.outputFormat === "json") {
        output(
          [
            {
              quoteId: updated.id,
              lineItemId: newLine?.id ?? null,
              lineItemCount: updated.lineItems?.length ?? 0,
              quote: updated,
            },
          ],
          { format: "json" },
        );
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      if (newLine?.id) {
        process.stdout.write(`  ${chalk.dim("New line ID:".padEnd(16))}${newLine.id}\n`);
      }
      process.stdout.write(`  ${chalk.dim("Total lines:".padEnd(16))}${updated.lineItems?.length ?? 0}\n`);
      process.stdout.write("\n");

      process.stderr.write(chalk.dim("  Try next:\n"));
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 quotes line-items list ${updated.id}`))}  ${chalk.dim("see all line items")}\n`);
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 quotes send ${updated.id}`))}  ${chalk.dim("send the quote to the customer")}\n\n`);
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to add line item");
    }
  });
