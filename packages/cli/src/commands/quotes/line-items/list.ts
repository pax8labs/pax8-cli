// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../../lib/context.js";
import { output, type Column } from "../../../lib/output.js";
import { createSpinner } from "../../../lib/spinner.js";
import { handleCommandError } from "../../../lib/errors.js";
import { formatCurrency, formatQuantity } from "../../../lib/formatters.js";
import { replCmd } from "../../../lib/confirm.js";

export const quotesLineItemsListCommand = new Command("list")
  .description("List the line items on a quote")
  .argument("<quote-id>", "Quote ID")
  .addHelpText(
    "after",
    `
Examples:
  pax8 quotes line-items list quote-summit-001
  pax8 quotes line-items list quote-summit-001 --json
  pax8 quotes line-items list quote-summit-001 --csv
  pax8 quotes line-items list quote-summit-001 --ids-only | xargs -I{} pax8 quotes line-items remove quote-summit-001 {}`
  )
  .option("--ids-only", "Output only line-item IDs, one per line")
  .action(async (quoteId, _options, command) => {
    const allOpts = command.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching quote...");

    try {
      spinner.start();
      const quote = await ctx.api.quotes.get(quoteId);
      spinner.stop();

      const lineItems = quote.lineItems ?? [];

      if (allOpts.idsOnly) {
        for (const li of lineItems) {
          if (li.id) process.stdout.write(li.id + "\n");
        }
        return;
      }

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(lineItems, null, 2) + "\n");
        return;
      }

      const columns: Column[] = [
        { key: "id", header: "Line ID", width: 22, format: (v) => v ? chalk.dim(String(v)) : chalk.dim("—") },
        { key: "productId", header: "Product ID", width: 26, format: (v) => chalk.dim(String(v)) },
        { key: "quantity", header: "Qty", width: 10, format: (v) => formatQuantity(Number(v)) },
        { key: "billingTerm", header: "Term", width: 10, format: (v) => v ? String(v) : "—" },
        { key: "unitPrice", header: "Unit", width: 12, format: (v) => v != null ? formatCurrency(Number(v)) : "—" },
        { key: "subtotal", header: "Subtotal", width: 14, format: (v) => v != null ? formatCurrency(Number(v)) : "—" },
      ];

      output(lineItems, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: `No line items on quote ${quote.id}.`,
          reasons: ["This quote is empty — add line items to make it sendable."],
          suggestions: [
            {
              command: replCmd(
                `pax8 quotes line-items add ${quote.id} --product <id|name> --quantity <n>`,
              ),
              description: "add a line item",
            },
          ],
        },
      });

      if (ctx.outputFormat === "table" && lineItems.length > 0) {
        process.stderr.write(
          chalk.dim(`\n  ${lineItems.length} line item${lineItems.length === 1 ? "" : "s"} on quote ${quote.id}\n`),
        );
        process.stderr.write(chalk.dim("\n  Try next:\n"));
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 quotes line-items add ${quote.id} --product <id|name> --quantity <n>`))}  ${chalk.dim("add another line item")}\n`);
        if (lineItems[0]?.id) {
          process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 quotes line-items remove ${quote.id} ${lineItems[0].id}`))}  ${chalk.dim("remove a line item")}\n`);
        }
        process.stderr.write("\n");
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list line items");
    }
  });
