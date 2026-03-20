import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import {
  formatStatus,
  formatCurrency,
  formatDate,
  formatQuantity,
} from "../../lib/formatters.js";

const historyColumns: Column[] = [
  { key: "date", header: "Date", format: (v: string) => formatDate(v) },
  { key: "field", header: "Field" },
  { key: "oldValue", header: "Old Value" },
  { key: "newValue", header: "New Value" },
];

export const subscriptionsShowCommand = new Command("show")
  .description("Show subscription details")
  .argument("<id>", "Subscription ID")
  .option("--history", "Show subscription change history")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions show sub-acme-m365bp-0001
  pax8 subscriptions show sub-acme-m365bp-0001 --history
  pax8 subscriptions show sub-acme-m365bp-0001 --json`
  )
  .action(async (id, options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() ?? {};
    const ctx = await buildContext({ ...parentOpts, ...options });
    const spinner = createSpinner("Fetching subscription...").start();

    try {
      const sub = await ctx.api.subscriptions.get(id);

      spinner.stop();

      if (ctx.outputFormat === "json") {
        if (options.history) {
          const history = await ctx.api.subscriptions.getHistory(id);
          output([{ ...sub, history: history.changes }], {
            format: "json",
          });
        } else {
          output([sub], { format: "json" });
        }
        return;
      }

      if (ctx.outputFormat === "csv") {
        output([sub], { format: "csv" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      // Table format: key-value display
      process.stdout.write("\n");
      const fields: [string, string][] = [
        ["ID", sub.id],
        ["Company", sub.companyName ?? sub.companyId],
        ["Product", sub.productName],
        ["Quantity", formatQuantity(sub.quantity)],
        ["Status", formatStatus(sub.status)],
        ["Price", formatCurrency(sub.price)],
        ["Billing Term", sub.billingTerm],
        ["Start Date", formatDate(sub.startDate)],
        ["Created", formatDate(sub.createdDate)],
        ["Provisioning", sub.provisioningStatus],
      ];

      if (sub.commitmentTermEndDate) {
        fields.push(["Term End", formatDate(sub.commitmentTermEndDate)]);
      }

      for (const [label, value] of fields) {
        process.stdout.write(
          `  ${chalk.bold(label.padEnd(18))} ${value}\n`
        );
      }
      process.stdout.write("\n");

      // Show history if requested
      if (options.history) {
        const history = await ctx.api.subscriptions.getHistory(id);
        if (history.changes.length > 0) {
          process.stdout.write(chalk.bold("  Change History\n\n"));
          output(history.changes, {
            format: "table",
            columns: historyColumns,
          });
          process.stdout.write("\n");
        } else {
          process.stdout.write(chalk.dim("  No change history.\n\n"));
        }
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to show subscription");
    }
  });
