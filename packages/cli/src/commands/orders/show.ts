// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { formatStatus, formatDate, formatCurrency } from "../../lib/formatters.js";
import { enrichProductNames } from "../../lib/enrich-subscriptions.js";
import { replCmd } from "../../lib/confirm.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";

const lineItemColumns: Column[] = [
  { key: "productName", header: "Product" },
  { key: "quantity", header: "Qty" },
  { key: "billingTerm", header: "Term" },
  {
    key: "unitPrice",
    header: "Price",
    format: (v) => (typeof v === "number" ? formatCurrency(v) : chalk.dim("—")),
  },
];

export const ordersShowCommand = new Command("show")
  .description("Show order details")
  .argument("<id>", "Order ID")
  .addHelpText(
    "after",
    `
Examples:
  pax8 orders show ord-summit-001
  pax8 orders show ord-summit-001 --json
  pax8 orders show ord-summit-001 --csv`
  )
  .action(async (id: string, options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const spinner = createSpinner("Fetching order...").start();

    try {
      const ctx = await buildContext(allOpts);
      const order = await ctx.api.orders.get(id);

      // ── Enrich company name ──────────────────────────────────────────────
      // Real API doesn't return companyName directly — join from companies.
      // Demo fixtures already populate companyName, so this is a no-op there.
      const orderRecord = order as Record<string, unknown>;
      if (!order.companyName && order.companyId) {
        try {
          const company = await ctx.api.companies.get(order.companyId);
          orderRecord.companyName = company.name;
        } catch {
          // Best effort — fall through to "Unknown" below.
        }
      }

      // ── Enrich line item product names + best-effort price ───────────────
      // Reuses the same helper subscriptions/companies use; bulk-fetches the
      // catalog and falls back to per-id lookups for anything missing.
      const lineItems = (order.lineItems ?? []) as Array<
        Record<string, unknown> & { productId: string; billingTerm?: string }
      >;
      if (lineItems.length > 0) {
        await enrichProductNames(ctx, lineItems);

        // Best-effort unit price lookup — pricing is product-specific and
        // billing-term-specific. Failures are silently ignored (price column
        // renders "—") so a missing pricing endpoint never breaks `orders show`.
        await Promise.all(
          lineItems.map(async (li) => {
            if (typeof li.unitPrice === "number") return;
            try {
              const pricing = await ctx.api.products.getPricing(li.productId);
              if (!pricing || pricing.length === 0) return;
              const match =
                pricing.find((p) => p.billingTerm === li.billingTerm) ??
                pricing[0];
              const rate = match?.rates?.[0]?.suggestedRetailPrice;
              if (typeof rate === "number") li.unitPrice = rate;
            } catch {
              /* best effort */
            }
          })
        );
      }

      spinner.stop();

      const companyDisplay =
        order.companyName ?? chalk.dim("Unknown company");

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(order, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "csv") {
        output([order], {
          format: "csv",
          columns: [
            { key: "id", header: "ID" },
            { key: "companyName", header: "Company" },
            // #385: canonical `createdAt`; legacy `createdDate` alias is still
            // present in `--json` for back-compat, but CSV/table use the new name.
            { key: "createdAt", header: "Date" },
            { key: "status", header: "Status" },
            { key: "orderedBy", header: "Ordered By" },
          ],
        });
        return;
      }

      // Table / detail view
      process.stdout.write("\n");
      process.stdout.write(chalk.bold(`  Order ${order.id}\n\n`));
      process.stdout.write(`  ${chalk.dim("Company:".padEnd(18))}${companyDisplay}\n`);
      if (order.status) process.stdout.write(`  ${chalk.dim("Status:".padEnd(18))}${formatStatus(order.status)}\n`);
      process.stdout.write(`  ${chalk.dim("Date:".padEnd(18))}${formatDate(order.createdAt)}\n`);
      process.stdout.write(`  ${chalk.dim("Ordered By:".padEnd(18))}${order.orderedBy ?? chalk.dim("—")}${order.orderedByEmail ? ` (${order.orderedByEmail})` : ""}\n`);
      process.stdout.write("\n");

      if (lineItems.length > 0) {
        process.stdout.write(chalk.dim(`  Line Items (${lineItems.length}):\n\n`));
        output(lineItems, { format: "table", columns: lineItemColumns });
        process.stdout.write("\n");
      }

      // Pickable next steps. From an order detail view, the natural moves
      // are: see the resulting subscription(s) on the customer, look at
      // the client summary, and check what else this client has ordered.
      const companyId = order.companyId ?? "";
      if (companyId) {
        const steps: NextStep[] = [
          {
            key: "1",
            label: `${chalk.cyan(replCmd(`pax8 subscriptions list --company "${order.companyName ?? companyId}"`))}  ${chalk.dim("see the resulting subscriptions")}`,
            command: ["subscriptions", "list", "--company", String(order.companyName ?? companyId)],
          },
          {
            key: "2",
            label: `${chalk.cyan(replCmd(`pax8 clients more "${order.companyName ?? companyId}"`))}  ${chalk.dim("view client")}`,
            command: ["clients", "more", String(order.companyName ?? companyId)],
          },
          {
            key: "3",
            label: `${chalk.cyan(replCmd(`pax8 orders list --company "${order.companyName ?? companyId}"`))}  ${chalk.dim("other orders on this client")}`,
            command: ["orders", "list", "--company", String(order.companyName ?? companyId)],
          },
        ];
        process.stderr.write(chalk.dim("  Try next:\n"));
        await promptNextSteps(steps, { renderList: true });
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to show order");
    }
  });
