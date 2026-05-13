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
import { promptNextSteps, type NextStep } from "../../../lib/next-step.js";

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
        // Pickable next steps. `quotes line-items add` needs --product +
        // --quantity values the user has to choose, so it can't be drilled
        // into by number — surfaced as an affordance pointer below.
        const steps: NextStep[] = [
          {
            key: "1",
            label: `${chalk.cyan(replCmd(`pax8 quotes show ${quote.id}`))}  ${chalk.dim("review the quote (total, status)")}`,
            command: ["quotes", "show", quote.id],
          },
        ];
        let n = 2;
        const firstWithId = lineItems.find((li) => Boolean(li.id));
        if (firstWithId?.id) {
          steps.push({
            key: String(n++),
            label: `${chalk.cyan(replCmd(`pax8 quotes line-items remove ${quote.id} ${firstWithId.id}`))}  ${chalk.dim("remove this line item")}`,
            command: ["quotes", "line-items", "remove", quote.id, firstWithId.id],
          });
        }
        steps.push({
          key: String(n++),
          label: `${chalk.cyan(replCmd(`pax8 quotes send ${quote.id}`))}  ${chalk.dim("send the quote to the customer")}`,
          command: ["quotes", "send", quote.id],
        });
        process.stderr.write(chalk.dim("\n  Try next:\n"));
        await promptNextSteps(steps, { renderList: true });
        process.stderr.write(
          chalk.dim(
            `  Add another line item — run ${chalk.cyan(replCmd("pax8 quotes line-items add --help"))} for syntax.\n\n`,
          ),
        );
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list line items");
    }
  });
