// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency } from "../../lib/formatters.js";
import { computeGrowth } from "@pax8/core";
import { output } from "../../lib/output.js";

export const reportGrowthCommand = new Command("growth")
  .description("MRR growth trend from invoice data")
  .option("--months <number>", "Number of months to show", "6")
  .addHelpText("after", `
Examples:
  pax8 report growth
  pax8 report growth --months 12
  pax8 report growth --json
  pax8 report growth --csv

Metric definitions:
  MRR (Monthly Recurring Revenue): Monthly recurring revenue from active
  subscriptions. For monthly billing terms: price × quantity. For annual
  billing terms: (price × quantity) ÷ 12. Excludes one-time charges and
  prorated amounts. Equivalent to "Partner Gross MRR" in Pax8's internal
  metric taxonomy.

  ARR (Annual Recurring Revenue): MRR × 12. The yearly equivalent of MRR,
  used to measure long-term financial health.`)
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const months = parseInt(options.months, 10) || 6;
    const spinner = createSpinner("Analyzing growth trend...").start();

    try {
      // Fetch invoices — get a large page to cover the requested months
      const invoicesResult = await ctx.api.invoices.list({ size: 200 });

      spinner.succeed("Growth trend calculated");

      const report = computeGrowth(invoicesResult.content, months);

      // Compute overall growth rate (first to last month)
      const monthData = report.months;
      let overallGrowthPercent = 0;
      if (monthData.length >= 2) {
        const first = monthData[0].mrr;
        const last = monthData[monthData.length - 1].mrr;
        overallGrowthPercent = first > 0 ? ((last - first) / first) * 100 : 0;
      }

      // Build nextActions
      const nextActions: { command: string; description: string }[] = [
        {
          command: "pax8 report mrr",
          description: "View current MRR breakdown by company",
        },
        {
          command: "pax8 invoices list",
          description: "View detailed invoice history",
        },
      ];

      // JSON output
      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify({
          months: monthData.map((m) => ({
            month: m.month,
            mrr: Number(m.mrr.toFixed(2)),
            delta: Number(m.delta.toFixed(2)),
            growthPercent: Number(m.growthPercent.toFixed(1)),
          })),
          averageGrowthPercent: Number(report.averageGrowth.toFixed(1)),
          overallGrowthPercent: Number(overallGrowthPercent.toFixed(1)),
          nextActions,
        }, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      // CSV output
      if (ctx.outputFormat === "csv") {
        const rows = monthData.map((m) => ({
          month: m.month,
          mrr: m.mrr.toFixed(2),
          delta: m.delta.toFixed(2),
          growthPercent: m.growthPercent.toFixed(1),
        }));
        const columns = [
          { key: "month", header: "Month" },
          { key: "mrr", header: "MRR" },
          { key: "delta", header: "Change" },
          { key: "growthPercent", header: "Growth %" },
        ];
        output(rows, { format: "csv", columns });
        return;
      }

      // Table output
      const out = process.stdout;
      out.write("\n");
      out.write(chalk.bold("  MRR Growth Trend\n\n"));

      const monthWidth = 12;
      const mrrWidth = 14;
      const changeWidth = 22;
      const header = `  ${chalk.cyan.bold("Month".padEnd(monthWidth))}  ${chalk.cyan.bold("MRR".padStart(mrrWidth))}  ${chalk.cyan.bold("Change".padEnd(changeWidth))}`;
      out.write(header + "\n");
      out.write(`  ${"─".repeat(monthWidth)}  ${"─".repeat(mrrWidth)}  ${"─".repeat(changeWidth)}\n`);

      for (const m of monthData) {
        const month = m.month.padEnd(monthWidth);
        const mrr = formatCurrency(m.mrr).padStart(mrrWidth);
        let change: string;
        if (m.delta === 0 && m.growthPercent === 0 && monthData.indexOf(m) === 0) {
          change = chalk.dim("—");
        } else {
          const sign = m.delta >= 0 ? "+" : "";
          const deltaStr = `${sign}${formatCurrency(m.delta)}`;
          const pctStr = `(${sign}${m.growthPercent.toFixed(1)}%)`;
          if (m.delta > 0) {
            change = chalk.green(`${deltaStr} ${pctStr}`);
          } else if (m.delta < 0) {
            change = chalk.red(`${deltaStr} ${pctStr}`);
          } else {
            change = chalk.dim(`${deltaStr} ${pctStr}`);
          }
        }
        out.write(`  ${month}  ${mrr}  ${change}\n`);
      }

      if (monthData.length >= 2) {
        out.write("\n");
        const avgLabel = report.averageGrowth >= 0
          ? chalk.green(`+${report.averageGrowth.toFixed(1)}%`)
          : chalk.red(`${report.averageGrowth.toFixed(1)}%`);
        out.write(`  ${chalk.dim("Avg monthly growth:")} ${avgLabel}\n`);
      }

      out.write("\n");
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to analyze growth");
    }
  });
