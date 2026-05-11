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
  type ProductPricingPlan,
} from "@pax8/core";
import type { CommandContext } from "../../../lib/context.js";

/**
 * Normalize a user-supplied `--effective-date` (or the default of "today,
 * UTC") to the ISO 8601 date-time string the v2 quoting API requires on
 * `AddStandardLineItemPayload`. Accepts `YYYY-MM-DD` for the user-friendly
 * shape; rejects anything that doesn't round-trip through `Date`. The output
 * is always midnight UTC of the chosen day — line-item effective dates are
 * day-grained on the upstream side, and pinning the time avoids accidental
 * day shifts when the user's local zone is ahead/behind UTC.
 */
function resolveEffectiveDate(raw: string | undefined): string {
  if (!raw) {
    // Today in UTC, midnight.
    const now = new Date();
    return `${now.toISOString().slice(0, 10)}T00:00:00Z`;
  }
  // Accept `YYYY-MM-DD` (strict — anything else is rejected to avoid
  // ambiguous zone-relative parses).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new CliError(
      `Invalid --effective-date: "${raw}"`,
      ["Use the YYYY-MM-DD format (e.g. 2026-06-01)"],
      undefined,
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (isNaN(parsed.getTime())) {
    throw new CliError(
      `Invalid --effective-date: "${raw}"`,
      ["Use a real calendar date in YYYY-MM-DD form"],
      undefined,
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  return `${raw}T00:00:00Z`;
}

/**
 * Resolve the default per-unit list price for a product at a given billing
 * term. Returns `suggestedRetailPrice` from the first matching pricing plan
 * (matching `cost-simulator` / `orders create` conventions). Returns
 * `undefined` if the product has no pricing or no plan for the chosen term —
 * callers fall back to requiring `--price` and surfacing a clear error.
 *
 * Caching is per-command-run via a module-level `Map` keyed by productId.
 * `quotes line-items add` is a single write per invocation, so this is
 * effectively a memoize on the one product the command touches.
 */
const pricingCache = new Map<string, ProductPricingPlan[]>();

async function resolveListPrice(
  ctx: CommandContext,
  productId: string,
  billingTerm: BillingTerm,
): Promise<number | undefined> {
  let pricing = pricingCache.get(productId);
  if (!pricing) {
    try {
      pricing = await ctx.api.products.getPricing(productId);
      pricingCache.set(productId, pricing);
    } catch {
      // Best-effort: a 404 / parse failure means we have no default to
      // offer. The caller will fail closed with a helpful message.
      return undefined;
    }
  }
  if (!pricing || pricing.length === 0) return undefined;

  // Term match: case-insensitive exact, with the Annual/Yearly alias the
  // rest of the codebase honors (see `cost-simulator.findPlan`).
  const want = billingTerm.toLowerCase();
  const plan =
    pricing.find((p) => p.billingTerm.toLowerCase() === want)
    ?? (want.includes("annual") || want.includes("yearly")
      ? pricing.find(
          (p) =>
            p.billingTerm.toLowerCase().includes("annual")
            || p.billingTerm.toLowerCase().includes("yearly"),
        )
      : undefined)
    ?? (want.includes("month")
      ? pricing.find((p) => p.billingTerm.toLowerCase().includes("month"))
      : undefined);

  if (!plan) return undefined;

  // First rate row — matches `orders create` (#312 note: real Pax8 pricing
  // can carry multiple tiers; quotes don't use them and the partner can
  // always override via `--price`).
  const rate = plan.rates?.[0];
  return rate?.suggestedRetailPrice;
}

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
