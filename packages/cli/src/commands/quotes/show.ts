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
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";

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
      const labelWidth = 18;
      const writeRow = (label: string, value: string) => {
        process.stdout.write(`  ${chalk.dim((label + ":").padEnd(labelWidth))}${value}\n`);
      };
      writeRow("Company ID", quote.companyId);
      if (quote.referenceCode) {
        writeRow("Reference", quote.referenceCode);
      }
      writeRow("Status", quote.status);
      if (quote.intentType) {
        writeRow("Intent", quote.intentType);
      }
      // #385: read canonical `createdAt` / `expiresAt`. Legacy `createdOn` /
      // `expiresOn` are still dual-emitted on `--json` for back-compat;
      // removal in v0.3.0.
      writeRow("Created", formatDate(quote.createdAt));
      if (quote.expiresAt) {
        writeRow("Expires", formatDate(quote.expiresAt));
      }
      if (quote.publishedOn) {
        writeRow("Published", formatDate(quote.publishedOn));
      } else if (quote.published === true) {
        writeRow("Published", "yes");
      }
      if (quote.acceptedBy) {
        const by = [quote.acceptedBy.name, quote.acceptedBy.email]
          .filter(Boolean)
          .join(" · ");
        const when = quote.acceptedBy.respondedOn ?? quote.respondedOn;
        const whenStr = when ? formatDate(when) : "";
        writeRow("Accepted", chalk.green(`✓ ${[whenStr, by].filter(Boolean).join(" by ")}`));
      } else if (quote.declinedBy) {
        const by = [quote.declinedBy.name, quote.declinedBy.email]
          .filter(Boolean)
          .join(" · ");
        const when = quote.declinedBy.respondedOn ?? quote.respondedOn;
        const whenStr = when ? formatDate(when) : "";
        writeRow("Declined", chalk.red(`✗ ${[whenStr, by].filter(Boolean).join(" by ")}`));
      } else if (quote.respondedOn) {
        writeRow("Responded", formatDate(quote.respondedOn));
      }
      if (quote.revokedOn) {
        writeRow("Revoked", formatDate(quote.revokedOn));
      }
      if (typeof quote.salesMarginPercentage === "number") {
        writeRow("Margin", `${quote.salesMarginPercentage.toFixed(1)}%`);
      }
      writeRow("Total", chalk.bold(formatCurrency(total)));
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

      // Pickable next steps. Status-dependent — the natural action varies
      // by where the quote is in its lifecycle:
      //   Draft  → `send` is the headline action; line-items add for
      //            quotes that aren't ready yet; delete to abandon.
      //   Sent   → `show` again to check responses; client view; delete.
      //   Accepted → place the order; client view; delete is not surfaced.
      // Other states fall through to the generic set.
      if (ctx.outputFormat === "table") {
        const steps: NextStep[] = [];
        const status = quote.status;
        let n = 1;
        if (status === "Draft") {
          steps.push({
            key: String(n++),
            label: `${chalk.cyan(replCmd(`pax8 quotes send ${quote.id}`))}  ${chalk.dim("send this quote to the customer")}`,
            command: ["quotes", "send", quote.id],
          });
          steps.push({
            key: String(n++),
            label: `${chalk.cyan(replCmd(`pax8 quotes line-items list ${quote.id}`))}  ${chalk.dim("inspect line items")}`,
            command: ["quotes", "line-items", "list", quote.id],
          });
        } else if (status === "Accepted") {
          // Pax8 processes acceptance server-side — there's no CLI command
          // that converts the quote into a CLI-side order. The natural
          // follow-on is to verify the resulting order/subscription landed
          // on the customer.
          steps.push({
            key: String(n++),
            label: `${chalk.cyan(replCmd(`pax8 orders list --company "${quote.companyId}"`))}  ${chalk.dim("check the resulting order")}`,
            command: ["orders", "list", "--company", quote.companyId],
          });
          steps.push({
            key: String(n++),
            label: `${chalk.cyan(replCmd(`pax8 subscriptions list --company "${quote.companyId}"`))}  ${chalk.dim("see the active subscription")}`,
            command: ["subscriptions", "list", "--company", quote.companyId],
          });
        } else {
          // Sent / Declined / Revoked / Expired — surface line items + client.
          steps.push({
            key: String(n++),
            label: `${chalk.cyan(replCmd(`pax8 quotes line-items list ${quote.id}`))}  ${chalk.dim("inspect line items")}`,
            command: ["quotes", "line-items", "list", quote.id],
          });
        }
        steps.push({
          key: String(n++),
          label: `${chalk.cyan(replCmd(`pax8 clients more "${quote.companyId}"`))}  ${chalk.dim("view client")}`,
          command: ["clients", "more", quote.companyId],
        });
        // Delete stays accessible from non-Accepted states; once accepted it
        // would orphan the downstream order and isn't a natural action.
        if (status !== "Accepted") {
          steps.push({
            key: String(n++),
            label: `${chalk.cyan(replCmd(`pax8 quotes delete ${quote.id}`))}  ${chalk.dim("delete this quote")}`,
            command: ["quotes", "delete", quote.id],
          });
        }
        process.stderr.write(chalk.dim("\n  Try next:\n"));
        await promptNextSteps(steps, { renderList: true });
        process.stderr.write(
          chalk.dim(
            `  You can also change the expiration or replace line items — run ${chalk.cyan(replCmd("pax8 quotes update --help"))} for syntax.\n\n`,
          ),
        );
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to show quote");
    }
  });
