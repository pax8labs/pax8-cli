import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import {
  formatStatus,
  formatCurrency,
  formatCompanyName,
} from "../../lib/formatters.js";

const columns: Column[] = [
  {
    key: "id",
    header: "ID",
    format: (v) => chalk.dim(String(v).slice(0, 8)),
  },
  {
    key: "companyName",
    header: "Company",
    format: (v) => formatCompanyName(String(v)),
  },
  { key: "productName", header: "Product" },
  { key: "quantity", header: "Qty", format: (v) => String(v) },
  { key: "status", header: "Status", format: (v) => formatStatus(String(v)) },
  { key: "billingTerm", header: "Term" },
  {
    key: "price",
    header: "Price",
    format: (v) => formatCurrency(Number(v)),
  },
];

export const subscriptionsListCommand = new Command("list")
  .description("List subscriptions")
  .option("--company <id>", "Filter by company ID")
  .option("--page <number>", "Page number", "0")
  .option("--size <number>", "Page size", "25")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions list
  pax8 subscriptions list --company a1b2c3d4-e5f6-7890-abcd-ef1234567890
  pax8 subscriptions list --size 10 --page 1
  pax8 subscriptions list --json`
  )
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching subscriptions...").start();

    try {
      const result = await ctx.api.subscriptions.list({
        companyId: options.company,
        page: parseInt(options.page, 10),
        size: parseInt(options.size, 10),
      });

      spinner.stop();

      if (options.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      output(result.content, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        process.stdout.write(
          chalk.dim(`\n  ${result.page.totalElements} subscriptions\n\n`)
        );
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to list subscriptions");
    }
  });
