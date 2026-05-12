// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { confirm, replCmd } from "../../lib/confirm.js";
import { resolveProduct } from "../../lib/resolve-product.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";
import { formatCurrency, formatQuantity } from "../../lib/formatters.js";
import {
  normalizeIsoDate,
  resolveEffectiveDate,
  resolveListPrice,
} from "../../lib/quote-line-item-defaults.js";
import { BillingTermSchema, ERROR_INVALID_INPUT, type Product } from "@pax8/core";
import type {
  AddQuoteLineItemInput,
  BillingTerm,
  QuoteLineItem,
  UpdateQuoteInput,
} from "@pax8/core";
import type { CommandContext } from "../../lib/context.js";
import { validateEnum } from "../../lib/validate.js";

const BILLING_TERM_VALUES = BillingTermSchema.options as readonly BillingTerm[];

/**
 * Best-effort lookup of product names for a set of productIds. Failures are
 * ignored — the diff falls back to the raw ID, which is still actionable.
 */
async function fetchProductNames(
  ctx: CommandContext,
  productIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(productIds)];
  const map = new Map<string, string>();
  await Promise.all(
    unique.map(async (pid) => {
      try {
        const product = await ctx.api.products.get(pid);
        if (product?.name) map.set(pid, product.name);
      } catch {
        /* best effort — fall back to the ID */
      }
    }),
  );
  return map;
}

/** Render one line of the diff: "  N. <name>  ×<qty>  ($<price>/<term>)" */
function renderLineItem(
  index: number,
  li: QuoteLineItem,
  productNames: Map<string, string>,
  nameWidth: number,
): string {
  const name = productNames.get(li.productId) ?? li.productId;
  const padded = name.length > nameWidth ? name : name.padEnd(nameWidth);
  const qty = `×${formatQuantity(li.quantity)}`;
  let priceBit = "";
  if (typeof li.unitPrice === "number") {
    const term = li.billingTerm === "Annual" ? "yr" : "mo";
    priceBit = chalk.dim(` (${formatCurrency(li.unitPrice)}/${term})`);
  } else if (li.billingTerm) {
    priceBit = chalk.dim(` (${li.billingTerm})`);
  }
  return `    ${index}. ${padded}  ${qty}${priceBit}`;
}

/**
 * Width of the product-name column in the diff table. Picked so columns
 * roughly align across current/new sections without truncating long names.
 */
function pickNameWidth(
  items: QuoteLineItem[],
  productNames: Map<string, string>,
): number {
  let max = 0;
  for (const li of items) {
    const name = productNames.get(li.productId) ?? li.productId;
    if (name.length > max) max = name.length;
  }
  // Cap a reasonable minimum/maximum to keep things tidy.
  return Math.min(Math.max(max, 24), 50);
}

export const quotesUpdateCommand = new Command("update")
  .description("Update a quote (replace line items or change expiration)")
  .argument("<id>", "Quote ID")
  .option("--product <id|name>", "Replace line items with a single line for this product")
  .option("--quantity <number>", "Quantity for the replacement line item", "1")
  .option(
    "--billing-term <term>",
    `Billing term — one of ${BILLING_TERM_VALUES.join(" | ")} (default Monthly)`,
    "Monthly",
  )
  .option("--expiration-date <date>", "New expiration date (YYYY-MM-DD)")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 quotes update quote-summit-001 --expiration-date 2026-05-15
  pax8 quotes update quote-bright-001 --product "Microsoft 365 E3" --quantity 20

Note:
  --product replaces ALL existing line items with a single new line. The
  Pax8 v2 quote API does not accept line-item replacement on PUT /v2/quotes/{id};
  the CLI decomposes the request into DELETE-existing + POST-new calls
  against /v2/quotes/{id}/line-items. If the quote has multiple line items,
  you'll see a clear destructive-replace warning before the change is applied.
  Cancel and use the marketplace UI if you need to preserve other lines.`,
  )
  .action(async (id, options, command) => {
    const globalOpts = command.optsWithGlobals();
    // Fail-fast on typo'd `--billing-term` BEFORE buildContext / any
    // network call (#408). Only relevant when `--product` is set; when
    // it isn't, billingTerm is unused by the update path.
    if (options.product !== undefined) {
      try {
        validateEnum(options.billingTerm, BILLING_TERM_VALUES, "--billing-term", {
          cmdHint: "pax8 quotes update",
        });
      } catch (error) {
        await handleCommandError(error);
      }
    }
    const ctx = await buildContext(globalOpts);

    try {
      // ── Parse flags into intent ──────────────────────────────────────────
      const overrides: UpdateQuoteInput = {};
      let resolvedProduct: Product | undefined;
      let replacementInput: AddQuoteLineItemInput | undefined;

      if (options.product) {
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
        resolvedProduct = await resolveProduct(ctx, options.product);
        const billingTerm = options.billingTerm as BillingTerm;
        // The v2 line-items POST requires `effectiveDate` and `price`. The
        // update path defaults both the same way `quotes create --product ...`
        // does (today UTC, product list price); the dedicated
        // `pax8 quotes line-items add` command exposes both as explicit flags
        // for partners who need to override them.
        const effectiveDate = resolveEffectiveDate(undefined);
        const price = await resolveListPrice(ctx, resolvedProduct.id, billingTerm);
        if (price === undefined) {
          throw new CliError(
            `No list price available for ${resolvedProduct.name} (${billingTerm})`,
            [
              "The replacement needs a default price to populate the new line item.",
              `Try: pax8 quotes line-items add ${id} --product "${options.product}" --quantity ${quantity} --price <number>`,
              "(combined with deleting the old line(s) yourself via `quotes line-items remove`)",
            ],
            undefined,
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
        replacementInput = {
          productId: resolvedProduct.id,
          quantity,
          billingTerm,
          effectiveDate,
          price,
        };
      }

      if (options.expirationDate) {
        // The `--expiration-date` CLI flag (camelCased to `options.expirationDate`
        // by Commander) keeps its v0.1 vocabulary, but the API field is
        // `expiresOn`. The v2 spec types it as `date-time`, so we normalize
        // the user's YYYY-MM-DD to ISO 8601 midnight-UTC before sending.
        overrides.expiresOn = normalizeIsoDate(
          options.expirationDate,
          "--expiration-date",
        );
      }

      const replacingLineItems = replacementInput !== undefined;
      const updatingTopLevel = Object.keys(overrides).length > 0;
      if (!replacingLineItems && !updatingTopLevel) {
        throw new CliError(
          "No fields to update",
          ["Use --product (with --quantity) to replace line items, or --expiration-date"],
          [`Try: ${replCmd("pax8 quotes update")} ${id} --expiration-date 2026-05-15`],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      const spinner = createSpinner("Fetching quote...").start();
      const current = await ctx.api.quotes.get(id);
      spinner.stop();

      const currentLineItems = current.lineItems ?? [];
      const destructiveReplace =
        replacingLineItems && currentLineItems.length >= 2;

      // Header
      process.stderr.write(chalk.bold("\n  Update Quote:\n\n"));
      process.stderr.write(`  ${chalk.dim("ID:".padEnd(18))}${current.id}\n`);
      process.stderr.write(`  ${chalk.dim("Current status:".padEnd(18))}${current.status}\n`);
      if (overrides.expiresOn) {
        // Display the user-facing YYYY-MM-DD, not the normalized date-time —
        // the partner shouldn't have to mentally undo the time-zone padding.
        process.stderr.write(
          `  ${chalk.dim("New expiration:".padEnd(18))}${chalk.green(options.expirationDate)}\n`,
        );
      }

      let confirmMessage: string;
      let confirmDefault: boolean;

      if (destructiveReplace && replacementInput) {
        // ── Loud destructive-replace diff ────────────────────────────────────
        // Pull product names for both the existing items AND the new one so
        // partners can read the diff at a glance instead of squinting at IDs.
        const newProductId = replacementInput.productId;
        const productIds = [
          ...currentLineItems.map((li) => li.productId),
          newProductId,
        ];
        // Seed with the already-resolved product so we don't refetch it.
        const productNames = await fetchProductNames(ctx, productIds);
        if (resolvedProduct) {
          productNames.set(resolvedProduct.id, resolvedProduct.name);
        }
        const newLineForDiff: QuoteLineItem = {
          productId: newProductId,
          quantity: replacementInput.quantity,
          billingTerm: replacementInput.billingTerm,
        };
        const nameWidth = pickNameWidth(
          [...currentLineItems, newLineForDiff],
          productNames,
        );

        process.stderr.write("\n");
        process.stderr.write(
          `  ${chalk.yellow.bold("Current line items (will be REPLACED):")}\n`,
        );
        currentLineItems.forEach((li, i) => {
          process.stderr.write(
            renderLineItem(i + 1, li, productNames, nameWidth) + "\n",
          );
        });

        process.stderr.write("\n");
        process.stderr.write(`  ${chalk.green.bold("New line items:")}\n`);
        process.stderr.write(
          renderLineItem(1, newLineForDiff, productNames, nameWidth) + "\n",
        );

        process.stderr.write("\n");
        process.stderr.write(
          `  ${chalk.red.bold(`This DESTROYS ${currentLineItems.length} existing line items.`)}\n`,
        );
        process.stderr.write(
          `  ${chalk.dim("The Pax8 v2 quote API has no per-line edit; existing lines are deleted and the new one is added.")}\n\n`,
        );

        confirmMessage = "Continue with destructive replace?";
        confirmDefault = false;
      } else if (replacingLineItems && replacementInput) {
        // Single existing line item (or none) — terser, default-yes confirm.
        const productName = resolvedProduct?.name ?? replacementInput.productId;
        process.stderr.write(
          `  ${chalk.dim("New line item:".padEnd(18))}${chalk.green(productName)} ${chalk.dim(`×${formatQuantity(replacementInput.quantity)}`)}\n`,
        );
        process.stderr.write(
          `  ${chalk.dim("Replaces:".padEnd(18))}${currentLineItems.length} existing item${currentLineItems.length === 1 ? "" : "s"}\n\n`,
        );
        confirmMessage = "Apply these changes?";
        confirmDefault = true;
      } else {
        // Date-only fast path.
        process.stderr.write("\n");
        confirmMessage = "Apply these changes?";
        confirmDefault = true;
      }

      const ok = await confirm(confirmMessage, { default: confirmDefault });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      // ── Apply ────────────────────────────────────────────────────────────
      // Order: top-level update first (cheap, idempotent on the PUT side),
      // then line-item decomposition (delete old → add new). If the delete
      // phase succeeds and the add fails we surface a recovery hint similar
      // to `quotes create`'s partial-failure flow (#311).
      let updated = current;
      const updateSpinner = createSpinner("Updating quote...").start();
      const doneUpdate = markWriteInFlight("quotes");
      try {
        if (updatingTopLevel) {
          updated = await ctx.api.quotes.update(id, overrides);
        }
      } finally {
        doneUpdate();
      }

      if (replacingLineItems && replacementInput) {
        // Delete existing lines. Items without an `id` (legacy demo data,
        // historical quotes) can't be addressed individually and are skipped
        // — the partner can use the marketplace UI for those edge cases.
        const removable = currentLineItems.filter(
          (li): li is QuoteLineItem & { id: string } => typeof li.id === "string",
        );
        for (const li of removable) {
          const doneRemove = markWriteInFlight("quotes");
          try {
            await ctx.api.quotes.removeLineItem(id, li.id);
          } finally {
            doneRemove();
          }
        }

        const doneAdd = markWriteInFlight("quotes");
        try {
          updated = await ctx.api.quotes.addLineItem(id, replacementInput);
        } catch (err) {
          doneAdd();
          updateSpinner.fail("Line item add failed");
          // The deletes already landed — the quote is now in a partial state
          // (no line items). Surface a clear recovery hint so the partner can
          // re-add manually.
          const recoveryCmd = `pax8 quotes line-items add ${id} --product ${options.product} --quantity ${replacementInput.quantity}`;
          process.stderr.write(
            chalk.yellow(
              `\n  ⚠ Existing line items were deleted but the replacement line-item add failed.\n`,
            ),
          );
          process.stderr.write(chalk.yellow("  Recover with:\n"));
          process.stderr.write(
            `    ${chalk.cyan(replCmd(recoveryCmd))}\n\n`,
          );
          await invalidateCacheAfterWrite();
          throw err;
        }
        doneAdd();
      }

      await invalidateCacheAfterWrite();
      updateSpinner.succeed("Quote updated");

      if (ctx.outputFormat === "json") {
        output([updated], { format: "json" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("ID:".padEnd(14))}${updated.id}\n`);
      process.stdout.write(`  ${chalk.dim("Status:".padEnd(14))}${updated.status}\n`);
      // #385: read canonical `expiresAt`. `expiresOn` is still dual-emitted
      // on `--json` for back-compat; removal in v0.3.0.
      if (updated.expiresAt) {
        process.stdout.write(`  ${chalk.dim("Expires:".padEnd(14))}${updated.expiresAt}\n`);
      }
      process.stdout.write(`  ${chalk.dim("Items:".padEnd(14))}${updated.lineItems?.length ?? 0}\n`);
      process.stdout.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to update quote");
    }
  });
