import { Command } from "commander";
import chalk from "chalk";
import { getUpcomingRenewals } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import {
  formatDaysUntil,
  formatCurrency,
  formatCompanyName,
} from "../../lib/formatters.js";

function parseWithinDays(within: string): number {
  const match = within.match(/^(\d+)d$/);
  if (!match) {
    throw new Error(
      `Invalid --within value: "${within}". Use format like 7d, 14d, 30d, 90d.`
    );
  }
  return parseInt(match[1], 10);
}

const columns: Column[] = [
  {
    key: "companyName",
    header: "Company",
    format: (v) => formatCompanyName(String(v)),
  },
  { key: "productName", header: "Product" },
  { key: "quantity", header: "Quantity", format: (v) => String(v) },
  {
    key: "renewalDate",
    header: "Renews",
    format: (v) => formatDaysUntil(v as Date),
  },
  { key: "billingTerm", header: "Term" },
];

export const subscriptionsRenewalsCommand = new Command("renewals")
  .description("Show upcoming subscription renewals")
  .option("--within <period>", "Time window (e.g. 7d, 14d, 30d, 90d)", "30d")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions renewals
  pax8 subscriptions renewals --within 7d
  pax8 subscriptions renewals --within 90d
  pax8 subscriptions renewals --json`
  )
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching subscriptions...").start();

    try {
      const withinDays = parseWithinDays(options.within);

      // Fetch all subscriptions (large page to get them all)
      const result = await ctx.api.subscriptions.list({ size: 1000 });
      const allSubs = result.content;

      spinner.stop();

      const report = getUpcomingRenewals(allSubs, withinDays);

      if (ctx.outputFormat === "json") {
        output(
          report.items.map((item) => ({
            ...item,
            renewalDate: item.renewalDate.toISOString().split("T")[0],
          })),
          { format: "json" }
        );
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      if (ctx.outputFormat === "csv") {
        output(
          report.items.map((item) => ({
            ...item,
            renewalDate: item.renewalDate.toISOString().split("T")[0],
          })),
          { format: "csv", columns }
        );
        return;
      }

      if (report.items.length === 0) {
        process.stdout.write(
          chalk.green(`\n  No subscriptions renewing within ${withinDays} days.\n\n`)
        );
        return;
      }

      output(report.items, { format: "table", columns });

      process.stdout.write(
        chalk.dim(
          `\n  ${report.items.length} renewals within ${withinDays} days — ${formatCurrency(report.totalMrrAtRisk)} MRR at risk\n`
        )
      );

      // Urgent annual warning
      const urgentAnnual = report.items.filter(
        (i) =>
          i.daysUntilRenewal <= 14 &&
          (i.billingTerm.toLowerCase().includes("annual") ||
            i.billingTerm.toLowerCase().includes("yearly"))
      );

      if (urgentAnnual.length > 0) {
        process.stdout.write(
          chalk.yellow(
            `\n  ⚠ ${urgentAnnual.length} annual subscription${urgentAnnual.length !== 1 ? "s" : ""} renewing within 14 days. Review quantities before lock-in.\n`
          )
        );
      }

      process.stdout.write("\n");
    } catch (error) {
      handleCommandError(error, spinner, "Failed to fetch renewals");
    }
  });
