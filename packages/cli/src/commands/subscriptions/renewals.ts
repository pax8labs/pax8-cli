// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ALL_SUBS_PAGE_SIZE, getUpcomingRenewals } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import {
  formatDaysUntil,
  formatCurrency,
  formatCompanyName,
} from "../../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";
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
  .option("--with-actions", "Wrap JSON output as { renewals, nextActions } instead of a flat array")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions renewals
  pax8 subscriptions renewals --within 7d
  pax8 subscriptions renewals --company "Summit Healthcare"
  pax8 subscriptions renewals --json

Metric definitions:
  MRR (Monthly Recurring Revenue): Monthly recurring revenue from active
  subscriptions. For monthly billing terms: price × quantity. For annual
  billing terms: (price × quantity) ÷ 12. Excludes one-time charges and
  prorated amounts. Equivalent to "Partner Gross MRR" in Pax8's internal
  metric taxonomy.

  ARR (Annual Recurring Revenue): MRR × 12. The yearly equivalent of MRR,
  used to measure long-term financial health.`
  )
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching subscriptions...").start();

    try {
      const withinDays = parseWithinDays(options.within);

      // Fetch subscriptions and companies in parallel
      const companyId = options.company
        ? await resolveCompanyId(ctx, options.company)
        : undefined;
      const [result, companiesResult] = await Promise.all([
        ctx.api.subscriptions.list({ size: ALL_SUBS_PAGE_SIZE, companyId }),
        ctx.api.companies.list({ size: 200 }),
      ]);

      // Enrich with product and company names
      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) {
        companyNames.set(c.id, c.name);
      }
      enrichCompanyNames(companyNames, result.content);
      await enrichProductNames(ctx, result.content as Record<string, unknown>[]);
      const allSubs = result.content;

      spinner.stop();

      const report = getUpcomingRenewals(allSubs, withinDays);

      if (ctx.outputFormat === "json") {
        const renewalItems = report.items.map((item) => ({
          ...item,
          mrrAtRisk: Number(item.mrrAtRisk.toFixed(2)),
          arrAtRisk: Number(item.arrAtRisk.toFixed(2)),
          renewalDate: item.renewalDate.toISOString().split("T")[0],
        }));
        if (options.withActions) {
          const nextActions = report.items
            .slice(0, 5)
            .map((item) => ({
              command: `pax8 subscriptions show ${item.subscriptionId}`,
              description: `View renewal details for ${item.companyName} — ${item.productName} (${item.daysUntilRenewal}d)`,
            }));
          process.stdout.write(JSON.stringify({ renewals: renewalItems, nextActions }, null, 2) + "\n");
        } else {
          process.stdout.write(JSON.stringify(renewalItems, null, 2) + "\n");
        }
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
          chalk.green(`\n  🎉 No subscriptions renewing within ${withinDays} days. Smooth sailing!\n`)
        );
        if (report.skippedNoDate > 0) {
          process.stdout.write(
            chalk.dim(`  ℹ ${report.skippedNoDate} subscription${report.skippedNoDate !== 1 ? "s have" : " has"} no renewal date set — these may be month-to-month.\n`)
          );
        }
        process.stdout.write("\n");
        return;
      }

      output(report.items, { format: "table", columns });

      // Header keeps MRR primary (Pax8's canonical operational unit per the
      // Unified Semantic Layer / Voyager Alliance / dwh fact tables), with
      // ARR as a parallel companion. The per-row table stays MRR-only to
      // avoid clutter; ARR lives in the JSON for consumers who want it.
      // See #295 — PFR-86 escalations frame risk as "ARR at risk", so QBR /
      // strategic conversations get the right unit too.
      process.stdout.write(
        chalk.dim(
          `\n  ${report.items.length} renewals within ${withinDays} days — ${formatCurrency(report.totalMrrAtRisk)}/mo MRR · ${formatCurrency(report.totalArrAtRisk)}/yr ARR at risk\n`
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
      await handleCommandError(error, spinner, "Failed to fetch renewals");
    }
  });
