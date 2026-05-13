// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../../lib/context.js";
import { output } from "../../../lib/output.js";
import { createSpinner } from "../../../lib/spinner.js";
import { handleCommandError } from "../../../lib/errors.js";
import { confirm, replCmd } from "../../../lib/confirm.js";
import { resolveProduct } from "../../../lib/resolve-product.js";
import { invalidateCacheAfterWrite } from "../../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../../lib/signals.js";
import { formatQuantity, formatCurrency as formatPrice } from "../../../lib/formatters.js";
import { promptNextSteps, type NextStep } from "../../../lib/next-step.js";
import {
  BILLING_TERM_VALUES,
  buildLineItemPayload,
  parseBillingTerm,
  parsePriceOverride,
  parseQuantity,
} from "../_shared.js";

// `resolveEffectiveDate` and `resolveListPrice` moved to
// `packages/cli/src/lib/quote-line-item-defaults.ts` so #311's `quotes create`
// two-call orchestration can reuse the same defaults. Per #426 the
// `--price` / `--effective-date` flag wiring is also shared via
// `packages/cli/src/commands/quotes/_shared.ts` so the shorthand and the
// long-form path can't drift apart.

export const quotesLineItemsAddCommand = new Command("add")
  .description("Add a line item to a quote")
  .argument("<quote-id>", "Quote ID")
  .requiredOption("--product <id|name>", "Product ID or name (required)")
  .option("--quantity <number>", "Quantity", "1")
  .option(
    "--billing-term <term>",
    `Billing term — one of ${BILLING_TERM_VALUES.join(" | ")} (default Monthly)`,
    "Monthly",
  )
  .option(
    "--price <number>",
    "Per-unit price for the line (defaults to the product's list price for the chosen billing term)",
  )
  .option(
    "--effective-date <YYYY-MM-DD>",
    "Effective date for the line (defaults to today, UTC)",
  )
  // Mirror orders create's commitment-term flag pair (see
  // `packages/cli/src/commands/orders/create.ts:350-351`). Same descriptions,
  // same auto-resolve-from-existing-subscription behavior, same precedence
  // rule: when both flags are supplied, `--commitment-term-id` wins (the UUID
  // form short-circuits the lookup). Required for Microsoft NCE and other
  // commitment-priced SKUs per QUOTE-311 / QUOTE-1283 / NCE proration spike.
  .option(
    "--commitment-term <term>",
    "Commitment term (Monthly, 1-Year, or 3-Year) — auto-resolves to UUID from existing subscription",
  )
  .option(
    "--commitment-term-id <uuid>",
    "Commitment term UUID (from subscription commitment.id). If both --commitment-term and --commitment-term-id are supplied, --commitment-term-id takes precedence.",
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
      // Pre-flight validation runs before any network call (#408, #426).
      // The shared helpers validate `--billing-term`, `--quantity`, and
      // `--price` so the shorthand path (`quotes create`) gets the same
      // fail-fast behavior.
      parseBillingTerm(options.billingTerm, "pax8 quotes line-items add");
      parsePriceOverride(options.price);
      const quantity = parseQuantity(options.quantity);

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

      const built = await buildLineItemPayload(
        ctx,
        product,
        quantity,
        {
          quantity: options.quantity,
          billingTerm: options.billingTerm,
          price: options.price,
          effectiveDate: options.effectiveDate,
          commitmentTerm: options.commitmentTerm,
          commitmentTermId: options.commitmentTermId,
        },
        // Thread the quote's companyId so `--commitment-term <enum>` can be
        // auto-resolved against the partner's existing subscriptions (same
        // pattern orders create uses). For Microsoft NCE et al., this lets a
        // partner pass `--commitment-term 1-Year` and have the CLI find the
        // UUID without forcing them to surface it manually (#311 / #426).
        quote.companyId,
      );
      const { input, price, priceWasOverridden, effectiveDate, billingTerm } = built;

      process.stderr.write(chalk.bold("\n  Add line item:\n\n"));
      process.stderr.write(`  ${chalk.dim("Quote:".padEnd(18))}${quote.id} ${chalk.dim(`(${quote.status})`)}\n`);
      process.stderr.write(`  ${chalk.dim("Product:".padEnd(18))}${product.name}\n`);
      process.stderr.write(`  ${chalk.dim("Quantity:".padEnd(18))}${formatQuantity(quantity)}\n`);
      process.stderr.write(`  ${chalk.dim("Billing term:".padEnd(18))}${billingTerm}\n`);
      process.stderr.write(
        `  ${chalk.dim("Unit price:".padEnd(18))}${formatPrice(price)}${
          priceWasOverridden ? chalk.dim(" (override)") : chalk.dim(" (list)")
        }\n`,
      );
      process.stderr.write(
        `  ${chalk.dim("Effective date:".padEnd(18))}${effectiveDate.slice(0, 10)}\n`,
      );
      // Surface commitment when set (auto-resolved or supplied) so the
      // partner sees it before confirming. Mirrors orders create's
      // "Commitment:" row (`packages/cli/src/commands/orders/create.ts:587`).
      if (built.commitmentTerm) {
        process.stderr.write(
          `  ${chalk.dim("Commitment:".padEnd(18))}${built.commitmentTerm}\n`,
        );
      }
      process.stderr.write(`  ${chalk.dim("Existing items:".padEnd(18))}${quote.lineItems?.length ?? 0}\n\n`);

      const ok = await confirm("Add this line item?", { default: true });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

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

      // Pickable next steps after a successful line-item add.
      const steps: NextStep[] = [
        {
          key: "1",
          label: `${chalk.cyan(replCmd(`pax8 quotes show ${updated.id}`))}  ${chalk.dim("review the updated quote")}`,
          command: ["quotes", "show", String(updated.id)],
        },
        {
          key: "2",
          label: `${chalk.cyan(replCmd(`pax8 quotes line-items list ${updated.id}`))}  ${chalk.dim("see all line items")}`,
          command: ["quotes", "line-items", "list", String(updated.id)],
        },
        {
          key: "3",
          label: `${chalk.cyan(replCmd(`pax8 quotes send ${updated.id}`))}  ${chalk.dim("send the quote to the customer")}`,
          command: ["quotes", "send", String(updated.id)],
        },
      ];
      process.stderr.write(chalk.dim("  Try next:\n"));
      await promptNextSteps(steps, { renderList: true });
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to add line item");
    }
  });
