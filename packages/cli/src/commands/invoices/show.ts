// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatDate, formatStatus } from "../../lib/formatters.js";
import { replCmd } from "../../lib/confirm.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";

export const invoicesShowCommand = new Command("show")
  .description("Show invoice details")
  .argument("<id>", "Invoice ID")
  .addHelpText(
    "after",
    `
Examples:
  pax8 invoices show inv-summit-curr-001
  pax8 invoices show inv-summit-curr-001 --json
  pax8 invoices show inv-summit-curr-001 --csv`
  )
  .action(async (id, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching invoice...");

    try {
      spinner.start();
      const invoice = await ctx.api.invoices.get(id);
      spinner.stop();

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(invoice, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "csv") {
        const columns = [
          { key: "id", header: "ID" },
          { key: "companyName", header: "Company" },
          { key: "invoiceDate", header: "Date" },
          { key: "dueDate", header: "Due Date" },
          { key: "status", header: "Status" },
          { key: "total", header: "Total" },
          { key: "balance", header: "Balance" },
          { key: "currency", header: "Currency" },
        ];
        output([invoice], { format: "csv", columns });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      // Human-readable output
      process.stdout.write("\n");
      process.stdout.write(chalk.bold(`  Invoice ${invoice.id}\n\n`));
      process.stdout.write(`  ${chalk.dim("Company:".padEnd(18))}${invoice.companyName}\n`);
      process.stdout.write(`  ${chalk.dim("Date:".padEnd(18))}${formatDate(invoice.invoiceDate)}\n`);
      process.stdout.write(`  ${chalk.dim("Due Date:".padEnd(18))}${formatDate(invoice.dueDate)}\n`);
      process.stdout.write(`  ${chalk.dim("Status:".padEnd(18))}${formatStatus(invoice.status)}\n`);
      process.stdout.write(`  ${chalk.dim("Total:".padEnd(18))}${formatCurrency(invoice.total)}\n`);
      process.stdout.write(`  ${chalk.dim("Balance:".padEnd(18))}${formatCurrency(invoice.balance)}\n`);
      // Pickable next steps. Drill in by typing 1, 2, ... — every entry has
      // its arguments resolved from the invoice already loaded above.
      if (ctx.outputFormat === "table") {
        const steps: NextStep[] = [
          {
            key: "1",
            label: `${chalk.cyan(replCmd(`pax8 invoices items ${invoice.id}`))}  ${chalk.dim("view line items")}`,
            command: ["invoices", "items", "--invoice-id", invoice.id],
          },
          {
            key: "2",
            label: `${chalk.cyan(replCmd(`pax8 clients more "${invoice.companyName}"`))}  ${chalk.dim("view client")}`,
            command: ["clients", "more", String(invoice.companyName)],
          },
          {
            key: "3",
            label: `${chalk.cyan(replCmd(`pax8 invoices audit --company "${invoice.companyName}"`))}  ${chalk.dim("audit this client's invoices")}`,
            command: ["invoices", "audit", "--company", String(invoice.companyName)],
          },
        ];
        process.stderr.write(chalk.dim("  Try next:\n"));
        await promptNextSteps(steps, { renderList: true });
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to show invoice");
    }
  });
