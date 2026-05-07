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
import { ERROR_INVALID_INPUT, type Product } from "@pax8/core";
import type { UpdateQuoteInput, BillingTerm, QuoteLineItem } from "@pax8/core";
import type { CommandContext } from "../../lib/context.js";

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
  .option("--billing-term <term>", "Billing term (Monthly or Annual)", "Monthly")
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
  Pax8 v1 quote API does not support per-line edits. If the quote has
  multiple line items, you'll see a clear destructive-replace warning
  before the change is applied. Cancel and use the marketplace UI if you
  need to preserve other lines.`,
  )
  .action(async (id, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);

    try {
      const data: UpdateQuoteInput = {};
      let resolvedProduct: Product | undefined;

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
        data.lineItems = [
          {
            productId: resolvedProduct.id,
            quantity,
            billingTerm: options.billingTerm as BillingTerm,
          },
        ];
      }

      if (options.expirationDate) {
        data.expirationDate = options.expirationDate;
      }

      if (Object.keys(data).length === 0) {
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
      const replacingLineItems = data.lineItems !== undefined;
      const destructiveReplace = replacingLineItems && currentLineItems.length >= 2;

      // Header
      process.stderr.write(chalk.bold("\n  Update Quote:\n\n"));
      process.stderr.write(`  ${chalk.dim("ID:".padEnd(18))}${current.id}\n`);
      process.stderr.write(`  ${chalk.dim("Current status:".padEnd(18))}${current.status}\n`);
      if (data.expirationDate) {
        process.stderr.write(
          `  ${chalk.dim("New expiration:".padEnd(18))}${chalk.green(data.expirationDate)}\n`,
        );
      }

      let confirmMessage: string;
      let confirmDefault: boolean;

      if (destructiveReplace) {
        // ── Loud destructive-replace diff ────────────────────────────────────
        // Pull product names for both the existing items AND the new one so
        // partners can read the diff at a glance instead of squinting at IDs.
        const productIds = [
          ...currentLineItems.map((li) => li.productId),
          ...(data.lineItems ?? []).map((li) => li.productId),
        ];
        // Seed with the already-resolved product so we don't refetch it.
        const productNames = await fetchProductNames(ctx, productIds);
        if (resolvedProduct) {
          productNames.set(resolvedProduct.id, resolvedProduct.name);
        }
        const nameWidth = pickNameWidth(
          [...currentLineItems, ...(data.lineItems ?? [])],
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
        (data.lineItems ?? []).forEach((li, i) => {
          process.stderr.write(
            renderLineItem(i + 1, li, productNames, nameWidth) + "\n",
          );
        });

        process.stderr.write("\n");
        process.stderr.write(
          `  ${chalk.red.bold(`This DESTROYS ${currentLineItems.length} existing line items.`)}\n`,
        );
        process.stderr.write(
          `  ${chalk.dim("The Pax8 v1 quote API has no per-line edit; the whole list is replaced.")}\n\n`,
        );

        confirmMessage = "Continue with destructive replace?";
        confirmDefault = false;
      } else if (replacingLineItems) {
        // Single existing line item (or none) — terser, default-yes confirm.
        const newLine = (data.lineItems ?? [])[0];
        const productName = resolvedProduct?.name ?? newLine.productId;
        process.stderr.write(
          `  ${chalk.dim("New line item:".padEnd(18))}${chalk.green(productName)} ${chalk.dim(`×${formatQuantity(newLine.quantity)}`)}\n`,
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

      const updateSpinner = createSpinner("Updating quote...").start();
      const doneUpdate = markWriteInFlight("quotes");
      let updated;
      try {
        updated = await ctx.api.quotes.update(id, data);
      } finally {
        doneUpdate();
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
      if (updated.expirationDate) {
        process.stdout.write(`  ${chalk.dim("Expires:".padEnd(14))}${updated.expirationDate}\n`);
      }
      process.stdout.write(`  ${chalk.dim("Items:".padEnd(14))}${updated.lineItems?.length ?? 0}\n`);
      process.stdout.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to update quote");
    }
  });
