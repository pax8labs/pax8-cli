// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import type { UsageLine } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency } from "../../lib/formatters.js";
import { replCmd } from "../../lib/confirm.js";
import { normalizeIsoDate } from "../../lib/quote-line-item-defaults.js";
import { enrichProductNames } from "../../lib/enrich-subscriptions.js";
import { totalsByCurrency } from "./list.js";

/** Today as `YYYY-MM-DD` in the partner's local time zone. */
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const usageShowCommand = new Command("show")
  .description("Show usage summary details")
  .argument("<id>", "Usage summary ID")
  .option("--lines", "Include the per-product line breakdown for one day")
  .option("--date <YYYY-MM-DD>", "Day to break down with --lines (default: today); implies --lines")
  .addHelpText(
    "after",
    `
Examples:
  pax8 usage show usage-redwood-acronis-curr
  pax8 usage show usage-redwood-acronis-curr --lines
  pax8 usage show usage-redwood-acronis-curr --date 2026-04-15
  pax8 usage show usage-redwood-acronis-curr --lines --json

Notes:
  A summary is the current billing period's usage for one resource group.
  The Pax8 API only returns line items one day at a time, so --lines shows
  a single day (today unless --date is given).`
  )
  .action(async (id, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching usage summary...");

    try {
      const wantLines = Boolean(options.lines || options.date);
      // Validate before any network call so a typo fails fast.
      const usageDate = options.date
        ? normalizeIsoDate(String(options.date), "--date").slice(0, 10)
        : localToday();

      spinner.start();
      const summary = await ctx.api.usage.getSummary(id);
      const lines: UsageLine[] = wantLines
        ? (await ctx.api.usage.listLines(id, { usageDate, size: 1000 })).content
        : [];

      // Names aren't on the wire. Best-effort: a lookup failure keeps the IDs.
      if (!summary.companyName) {
        try {
          summary.companyName = (await ctx.api.companies.get(summary.companyId)).name;
        } catch {
          // Leave unset; rendered as "—".
        }
      }
      try {
        await enrichProductNames(ctx, [summary]);
      } catch {
        // Same as above.
      }
      spinner.stop();

      const currency = summary.currencyCode ?? "USD";
      const money = (v: unknown, row?: Record<string, unknown>) =>
        formatCurrency(Number(v), String(row?.currencyCode ?? currency));

      if (ctx.outputFormat === "json") {
        const payload = wantLines ? { ...summary, usageDate, lines } : summary;
        process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "csv") {
        if (wantLines) {
          const columns = [
            { key: "usageDate", header: "Date" },
            { key: "productName", header: "Product" },
            { key: "unitOfMeasure", header: "Unit" },
            { key: "quantity", header: "Quantity" },
            { key: "unitPrice", header: "Unit Price" },
            { key: "currentCharges", header: "Charges" },
            { key: "partnerTotal", header: "Partner Total" },
            { key: "currentProfit", header: "Profit" },
            { key: "currencyCode", header: "Currency" },
          ];
          output(lines, { format: "csv", columns });
        } else {
          const columns = [
            { key: "id", header: "ID" },
            { key: "companyName", header: "Company" },
            { key: "productName", header: "Product" },
            { key: "vendorName", header: "Vendor" },
            { key: "resourceGroup", header: "Resource Group" },
            { key: "currentCharges", header: "Charges" },
            { key: "partnerTotal", header: "Partner Total" },
            { key: "currencyCode", header: "Currency" },
            { key: "isTrial", header: "Trial" },
          ];
          output([summary], { format: "csv", columns });
        }
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      const row = (label: string, value: string) =>
        process.stdout.write(`  ${chalk.dim(label.padEnd(18))}${value}\n`);
      process.stdout.write("\n");
      process.stdout.write(chalk.bold(`  Usage Summary ${summary.id}\n\n`));
      row("Company:", summary.companyName ?? "—");
      row("Product:", summary.productName ?? "—");
      row("Vendor:", summary.vendorName ?? "—");
      row("Resource group:", summary.resourceGroup ?? "—");
      row("Charges:", formatCurrency(summary.currentCharges, currency));
      row("Partner total:", formatCurrency(summary.partnerTotal, currency));
      if (summary.isTrial) row("Trial:", "yes");
      process.stdout.write(chalk.dim(`\n  Current billing period to date.\n\n`));

      if (wantLines) {
        if (lines.length === 0) {
          process.stdout.write(chalk.dim(`  No usage lines for ${usageDate}.\n\n`));
        } else {
          process.stdout.write(chalk.bold(`  Lines for ${usageDate}\n\n`));
          const columns = [
            { key: "productName", header: "Product", width: 36 },
            { key: "unitOfMeasure", header: "Unit", width: 10 },
            { key: "quantity", header: "Qty", width: 10 },
            { key: "unitPrice", header: "Unit price", width: 12, format: money },
            { key: "currentCharges", header: "Charges", width: 12, format: money },
            { key: "partnerTotal", header: "Partner total", width: 15, format: money },
          ];
          output(lines, { format: ctx.outputFormat, columns });
          process.stderr.write(
            chalk.dim(
              `\n  ${lines.length} lines · ` +
                `${totalsByCurrency(lines, (l) => l.currentCharges)} charges · ` +
                `${totalsByCurrency(lines, (l) => l.partnerTotal)} partner total\n`,
            ),
          );
        }
      }

      if (ctx.outputFormat === "table") {
        process.stderr.write(chalk.dim("\n  Try next:\n"));
        if (!wantLines) {
          process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 usage show ${summary.id} --lines`))}  ${chalk.dim("view today's per-product breakdown")}\n`);
        } else {
          process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 usage show ${summary.id} --date YYYY-MM-DD`))}  ${chalk.dim("break down a different day")}\n`);
        }
        if (summary.companyName) {
          process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 invoices audit --company "${summary.companyName}"`))}  ${chalk.dim("reconcile against billing")}\n`);
        }
        process.stderr.write("\n");
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to show usage summary");
    }
  });
