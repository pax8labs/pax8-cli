// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatDate, formatCurrency, formatQuantity } from "../../lib/formatters.js";
import { replCmd } from "../../lib/confirm.js";

export const quotesShowCommand = new Command("show")
  .description("Show quote details with line items")
  .argument("<id>", "Quote ID")
  .addHelpText(
    "after",
    `
Examples:
  pax8 quotes show quote-summit-001
  pax8 quotes show quote-summit-001 --json
  pax8 quotes show quote-summit-001 --csv`
  )
  .action(async (id, _options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching quote...");

    try {
      spinner.start();
      const quote = await ctx.api.quotes.get(id);
      spinner.stop();

      const lineItems = quote.lineItems ?? [];
      const total = lineItems.reduce(
        (s, li) => s + (li.subtotal ?? (li.unitPrice ?? 0) * li.quantity),
        0,
      );

      if (ctx.outputFormat === "json") {
        process.stdout.write(
          JSON.stringify({ ...quote, total }, null, 2) + "\n"
        );
        return;
      }

      if (ctx.outputFormat === "csv") {
        const columns: Column[] = [
          { key: "productId", header: "Product ID" },
          { key: "quantity", header: "Quantity" },
          { key: "billingTerm", header: "Billing Term" },
          { key: "unitPrice", header: "Unit Price" },
          { key: "subtotal", header: "Subtotal" },
        ];
        output(lineItems, { format: "csv", columns });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(chalk.bold(`  Quote ${quote.id}\n\n`));
      process.stdout.write(`  ${chalk.dim("Company ID:".padEnd(16))}${quote.companyId}\n`);
      process.stdout.write(`  ${chalk.dim("Status:".padEnd(16))}${quote.status}\n`);
      process.stdout.write(`  ${chalk.dim("Created:".padEnd(16))}${formatDate(quote.createdDate)}\n`);
      if (quote.expirationDate) {
        process.stdout.write(`  ${chalk.dim("Expires:".padEnd(16))}${formatDate(quote.expirationDate)}\n`);
      }
      process.stdout.write(`  ${chalk.dim("Total:".padEnd(16))}${chalk.bold(formatCurrency(total))}\n`);
      process.stdout.write("\n");

      if (lineItems.length === 0) {
        process.stdout.write(chalk.dim("  No line items.\n\n"));
      } else {
        const columns: Column[] = [
          { key: "productId", header: "Product ID", width: 38 },
          { key: "quantity", header: "Qty", width: 10, format: (v) => formatQuantity(Number(v)) },
          { key: "billingTerm", header: "Term", width: 10 },
          { key: "unitPrice", header: "Unit", width: 12, format: (v) => v != null ? formatCurrency(Number(v)) : "—" },
          { key: "subtotal", header: "Subtotal", width: 14, format: (v) => v != null ? formatCurrency(Number(v)) : "—" },
        ];
        output(lineItems, { format: ctx.outputFormat, columns });
      }

      process.stderr.write(chalk.dim("\n  Try next:\n"));
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 quotes update ${quote.id} --expiration-date <YYYY-MM-DD>`))}  ${chalk.dim("update this quote")}\n`);
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 quotes delete ${quote.id}`))}  ${chalk.dim("delete this quote")}\n`);
      process.stderr.write("\n");
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to show quote");
    }
  });
