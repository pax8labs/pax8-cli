// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatDate } from "../../lib/formatters.js";
import { replCmd } from "../../lib/confirm.js";

export const usageShowCommand = new Command("show")
  .description("Show usage summary details")
  .argument("<id>", "Usage summary ID")
  .option("--lines", "Include per-resource line breakdown")
  .addHelpText(
    "after",
    `
Examples:
  pax8 usage show usage-redwood-acronis-curr
  pax8 usage show usage-redwood-acronis-curr --lines
  pax8 usage show usage-redwood-acronis-curr --lines --json`
  )
  .action(async (id, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching usage summary...");

    try {
      spinner.start();
      const summary = await ctx.api.usage.getSummary(id);
      const lines = options.lines
        ? (await ctx.api.usage.listLines(id, { size: 1000 })).content
        : [];
      spinner.stop();

      if (ctx.outputFormat === "json") {
        const payload = options.lines ? [{ ...summary, lines }] : [summary];
        output(payload, { format: "json" });
        return;
      }

      if (ctx.outputFormat === "csv") {
        if (options.lines) {
          const columns = [
            { key: "id", header: "Line ID" },
            { key: "description", header: "Description" },
            { key: "quantity", header: "Quantity" },
            { key: "unitPrice", header: "Unit Price" },
            { key: "subtotal", header: "Subtotal" },
            { key: "date", header: "Date" },
          ];
          output(lines, { format: "csv", columns });
        } else {
          const columns = [
            { key: "id", header: "ID" },
            { key: "companyName", header: "Company" },
            { key: "productName", header: "Product" },
            { key: "date", header: "Date" },
            { key: "quantity", header: "Quantity" },
            { key: "unitPrice", header: "Unit Price" },
            { key: "subtotal", header: "Subtotal" },
            { key: "resourceGroup", header: "Resource Group" },
          ];
          output([summary], { format: "csv", columns });
        }
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(chalk.bold(`  Usage Summary ${summary.id}\n\n`));
      process.stdout.write(`  ${chalk.dim("Company:".padEnd(18))}${summary.companyName ?? "—"}\n`);
      process.stdout.write(`  ${chalk.dim("Product:".padEnd(18))}${summary.productName ?? "—"}\n`);
      process.stdout.write(`  ${chalk.dim("Date:".padEnd(18))}${formatDate(summary.date)}\n`);
      process.stdout.write(`  ${chalk.dim("Quantity:".padEnd(18))}${summary.quantity}\n`);
      process.stdout.write(`  ${chalk.dim("Unit price:".padEnd(18))}${formatCurrency(summary.unitPrice)}\n`);
      process.stdout.write(`  ${chalk.dim("Subtotal:".padEnd(18))}${formatCurrency(summary.subtotal)}\n`);
      if (summary.resourceGroup) {
        process.stdout.write(`  ${chalk.dim("Resource group:".padEnd(18))}${summary.resourceGroup}\n`);
      }
      process.stdout.write("\n");

      if (options.lines) {
        if (lines.length === 0) {
          process.stdout.write(chalk.dim(`  No line items.\n\n`));
        } else {
          const columns = [
            { key: "description", header: "Resource", width: 36 },
            { key: "quantity", header: "Qty", width: 10 },
            { key: "unitPrice", header: "Unit", width: 12, format: (v: unknown) => formatCurrency(Number(v)) },
            { key: "subtotal", header: "Subtotal", width: 14, format: (v: unknown) => formatCurrency(Number(v)) },
          ];
          output(lines, { format: ctx.outputFormat, columns });
          const total = lines.reduce((s, l) => s + (l.subtotal ?? 0), 0);
          process.stderr.write(chalk.dim(`\n  ${lines.length} lines · ${formatCurrency(total)} total\n`));
        }
      }

      if (ctx.outputFormat === "table") {
        process.stderr.write(chalk.dim("\n  Try next:\n"));
        if (!options.lines) {
          process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 usage show ${summary.id} --lines`))}  ${chalk.dim("view per-resource breakdown")}\n`);
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
