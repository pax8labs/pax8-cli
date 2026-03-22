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
import { enrichProductNames } from "../../lib/enrich-subscriptions.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";

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
  { key: "quantity", header: "Qty", format: (v) => String(v) },
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
  .option("--company <id|name>", "Filter by company")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions renewals
  pax8 subscriptions renewals --within 7d
  pax8 subscriptions renewals --company "Summit Healthcare"
  pax8 subscriptions renewals --json`
  )
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching subscriptions...").start();

    try {
      const withinDays = parseWithinDays(options.within);

      // Fetch subscriptions, optionally filtered by company
      const companyId = options.company
        ? await resolveCompanyId(ctx, options.company)
        : undefined;
      const result = await ctx.api.subscriptions.list({ size: 1000, companyId });
      await enrichProductNames(ctx, result.content as Record<string, unknown>[]);
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
          chalk.green(`\n  🎉 No subscriptions renewing within ${withinDays} days. Smooth sailing!\n\n`)
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
            `\n  ⚠ ${urgentAnnual.length} annual subscription${urgentAnnual.length !== 1 ? "s" : ""} renewing within 14 days\n`
          )
        );
        process.stdout.write(chalk.dim("    Before lock-in, you can:\n"));
        process.stdout.write(chalk.dim("    • Reduce seats to match actual usage\n"));
        process.stdout.write(chalk.dim("    • Switch billing term (monthly ↔ annual)\n"));
        process.stdout.write(chalk.dim("    • Cancel if the customer is churning\n"));
      }

      // Show actionable commands for the most urgent items
      if (ctx.outputFormat === "table" && report.items.length > 0) {
        const top = report.items[0];
        process.stderr.write(chalk.dim("\n  Try next:\n"));
        process.stderr.write(`    ${chalk.cyan(`subscriptions show ${top.subscriptionId}`)}  ${chalk.dim("view details")}\n`);
        process.stderr.write(`    ${chalk.cyan(`subscriptions update ${top.subscriptionId} --quantity <n>`)}  ${chalk.dim("adjust seats")}\n`);
        process.stderr.write(`    ${chalk.cyan(`companies more "${top.companyName}"`)}  ${chalk.dim("view company")}\n`);
      }

      process.stdout.write("\n");
    } catch (error) {
      handleCommandError(error, spinner, "Failed to fetch renewals");
    }
  });
