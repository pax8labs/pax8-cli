// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../../lib/context.js";
import { output } from "../../../lib/output.js";
import { createSpinner } from "../../../lib/spinner.js";
import { handleCommandError, CliError } from "../../../lib/errors.js";
import { confirm, replCmd } from "../../../lib/confirm.js";
import { invalidateCacheAfterWrite } from "../../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../../lib/signals.js";
import { formatCurrency, formatQuantity } from "../../../lib/formatters.js";
import { ERROR_QUOTE_LINE_ITEM_NOT_FOUND } from "@pax8/core";

export const quotesLineItemsRemoveCommand = new Command("remove")
  .description("Remove a line item from a quote")
  .argument("<quote-id>", "Quote ID")
  .argument("<line-item-id>", "Line item ID (from `quotes line-items list`)")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 quotes line-items remove quote-summit-001 li-summit-001-b
  pax8 quotes line-items remove quote-summit-001 li-summit-001-b --yes`,
  )
  .action(async (quoteId, lineItemId, _options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);

    try {
      const fetchSpinner = createSpinner("Fetching quote...").start();
      const quote = await ctx.api.quotes.get(quoteId);
      fetchSpinner.stop();

      const lineItems = quote.lineItems ?? [];
      const target = lineItems.find((li) => li.id === lineItemId);
      if (!target) {
        throw new CliError(
          `Line item "${lineItemId}" not found on quote ${quoteId}.`,
          ["No line item on this quote has that ID."],
          [`Run ${replCmd(`pax8 quotes line-items list ${quoteId}`)} to see valid IDs.`],
          undefined,
          ERROR_QUOTE_LINE_ITEM_NOT_FOUND,
        );
      }

      process.stderr.write(chalk.bold("\n  Remove line item:\n\n"));
      process.stderr.write(`  ${chalk.dim("Quote:".padEnd(18))}${quote.id} ${chalk.dim(`(${quote.status})`)}\n`);
      process.stderr.write(`  ${chalk.dim("Line item:".padEnd(18))}${target.id ?? "—"}\n`);
      process.stderr.write(`  ${chalk.dim("Product:".padEnd(18))}${target.productId}\n`);
      process.stderr.write(`  ${chalk.dim("Quantity:".padEnd(18))}${formatQuantity(target.quantity)}\n`);
      if (target.billingTerm) {
        process.stderr.write(`  ${chalk.dim("Billing term:".padEnd(18))}${target.billingTerm}\n`);
      }
      if (typeof target.subtotal === "number") {
        process.stderr.write(`  ${chalk.dim("Subtotal:".padEnd(18))}${formatCurrency(target.subtotal)}\n`);
      }
      process.stderr.write("\n");

      const ok = await confirm("Remove this line item?", { default: false });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Removing line item...").start();
      const done = markWriteInFlight("quotes");
      try {
        await ctx.api.quotes.removeLineItem(quoteId, lineItemId);
      } finally {
        done();
      }
      await invalidateCacheAfterWrite();
      spinner.succeed("Line item removed");

      if (ctx.outputFormat === "json") {
        output(
          [{ quoteId, lineItemId, status: "Removed" }],
          { format: "json" },
        );
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      const remaining = lineItems.length - 1;
      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("Remaining lines:".padEnd(18))}${remaining}\n`);
      process.stdout.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to remove line item");
    }
  });
