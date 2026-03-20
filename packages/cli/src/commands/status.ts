import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../lib/context.js";
import { createSpinner } from "../lib/spinner.js";
import { handleCommandError } from "../lib/errors.js";
import { formatCurrency } from "../lib/formatters.js";
import { promptNextSteps, type NextStep } from "../lib/next-step.js";
import { getUpcomingRenewals } from "@pax8/core";
import { getRecommendations } from "@pax8/core";

export const statusCommand = new Command("status")
  .description("Quick snapshot of your Pax8 business")
  .addHelpText("after", `
Examples:
  pax8 status
  pax8 status --json`)
  .action(async (_options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Loading dashboard...").start();

    try {
      // Fetch companies, subscriptions, and products in parallel
      const [companiesResult, subsResult, productsResult] = await Promise.all([
        ctx.api.companies.list({ size: 1 }),
        ctx.api.subscriptions.list({ size: 1000 }),
        ctx.api.products.list({ size: 200 }),
      ]);

      spinner.succeed("Dashboard loaded");

      // Compute MRR from active subs
      const allSubs = subsResult.content as Array<Record<string, unknown>>;
      const activeSubs = allSubs.filter((s) => String(s.status) === "Active");
      let mrr = 0;
      let totalSeats = 0;
      const companyIds = new Set<string>();
      for (const sub of activeSubs) {
        const price = (sub.price as number) ?? 0;
        const qty = (sub.quantity as number) ?? 0;
        const term = String(sub.billingTerm ?? "Monthly");
        mrr += term.toLowerCase().includes("annual") ? (price * qty) / 12 : price * qty;
        totalSeats += qty;
        companyIds.add(String(sub.companyId));
      }

      // Renewals in next 30 days
      const renewals = getUpcomingRenewals(allSubs as never[], 30);

      // Recommendations
      const recsReport = getRecommendations(
        activeSubs as never[],
        productsResult.content as never[],
      );
      const highRecs = recsReport.recommendations.filter((r) => r.priority === "high");

      // Trials
      const trials = allSubs.filter((s) => String(s.status) === "Trial");

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify({
          totalCompanies: companiesResult.page.totalElements,
          activeSubscriptions: activeSubs.length,
          companiesWithActiveSubs: companyIds.size,
          totalSeats,
          mrr: Number(mrr.toFixed(2)),
          arr: Number((mrr * 12).toFixed(2)),
          renewalsNext30Days: renewals.items.length,
          urgentRenewals: renewals.urgentCount,
          mrrAtRisk: Number(renewals.totalMrrAtRisk.toFixed(2)),
          highPriorityRecs: highRecs.length,
          potentialMrrUplift: Number(highRecs.reduce((s, r) => s + (r.estimatedMrrUplift ?? 0), 0).toFixed(2)),
          activeTrials: trials.length,
        }, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      const arr = mrr * 12;

      process.stdout.write("\n");
      process.stdout.write(chalk.bold("  Pax8 Business Snapshot\n\n"));

      // Revenue
      process.stdout.write(`  ${chalk.cyan.bold(formatCurrency(mrr))}/mo MRR  ·  ${chalk.cyan.bold(formatCurrency(arr))}/yr ARR\n\n`);
      process.stdout.write(`  ${chalk.dim("Companies:")}     ${companiesResult.page.totalElements}\n`);
      process.stdout.write(`  ${chalk.dim("Active subs:")}   ${activeSubs.length} across ${companyIds.size} companies\n`);
      process.stdout.write(`  ${chalk.dim("Total seats:")}   ${totalSeats.toLocaleString()}\n`);
      if (companyIds.size > 0) {
        process.stdout.write(`  ${chalk.dim("Avg MRR/co:")}    ${formatCurrency(mrr / companyIds.size)}\n`);
      }

      // Alerts section
      const alerts: string[] = [];

      if (renewals.urgentCount > 0) {
        alerts.push(
          chalk.red.bold(`  ! ${renewals.urgentCount} renewal${renewals.urgentCount > 1 ? "s" : ""} in the next 14 days`) +
          chalk.red(` — ${formatCurrency(renewals.totalMrrAtRisk)}/mo at risk`)
        );
      } else if (renewals.items.length > 0) {
        alerts.push(
          chalk.yellow(`  ! ${renewals.items.length} renewal${renewals.items.length > 1 ? "s" : ""} in the next 30 days`) +
          chalk.dim(` — ${formatCurrency(renewals.totalMrrAtRisk)}/mo at risk`)
        );
      }

      if (highRecs.length > 0) {
        const uplift = highRecs.reduce((s, r) => s + (r.estimatedMrrUplift ?? 0), 0);
        alerts.push(
          chalk.green(`  + ${highRecs.length} growth opportunit${highRecs.length > 1 ? "ies" : "y"}`) +
          chalk.green.bold(` — ${formatCurrency(uplift)}/mo potential MRR`)
        );
      }

      if (trials.length > 0) {
        alerts.push(
          chalk.yellow(`  ~ ${trials.length} active trial${trials.length > 1 ? "s" : ""}`) +
          chalk.dim(" — convert or cancel before they expire")
        );
      }

      if (alerts.length > 0) {
        process.stdout.write(`\n  ${chalk.dim("─".repeat(48))}\n\n`);
        for (const alert of alerts) {
          process.stdout.write(alert + "\n");
        }
      }

      process.stdout.write("\n");

      // Build dynamic next steps based on what needs attention
      const nextSteps: NextStep[] = [];
      if (renewals.urgentCount > 0) {
        nextSteps.push({ key: "1", label: `View urgent renewals (${renewals.urgentCount})`, command: ["pax8", "subscriptions", "renewals", "--within", "14"] });
      } else if (renewals.items.length > 0) {
        nextSteps.push({ key: "1", label: `View upcoming renewals (${renewals.items.length})`, command: ["pax8", "subscriptions", "renewals"] });
      }
      if (highRecs.length > 0) {
        nextSteps.push({ key: String(nextSteps.length + 1), label: `View growth opportunities (${highRecs.length})`, command: ["pax8", "recommendations", "list", "--priority", "high"] });
      }
      nextSteps.push({ key: String(nextSteps.length + 1), label: "View customers", command: ["pax8", "companies", "list"] });

      await promptNextSteps(nextSteps);
    } catch (error) {
      handleCommandError(error, spinner, "Failed to load status");
    }
  });
