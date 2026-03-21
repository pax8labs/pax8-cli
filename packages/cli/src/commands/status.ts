import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../lib/context.js";
import { createSpinner } from "../lib/spinner.js";
import { handleCommandError } from "../lib/errors.js";
import { formatCurrency } from "../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../lib/enrich-subscriptions.js";
import { getUpcomingRenewals } from "@pax8/core";
import { getRecommendations } from "@pax8/core";
import type { Subscription } from "@pax8/core";
import { replCmd } from "../lib/confirm.js";

export const statusCommand = new Command("status")
  .description("Quick snapshot of your Pax8 business")
  .option("--all", "Show full dashboard with all sections")
  .option("--customers", "Show top customers by MRR")
  .option("--renewals", "Show upcoming renewal details")
  .option("--growth", "Show growth opportunities")
  .addHelpText("after", `
Examples:
  pax8 status
  pax8 status --all
  pax8 status --customers
  pax8 status --renewals --growth
  pax8 status --json`)
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Loading dashboard...").start();

    try {
      // Fetch companies, subscriptions, and products in parallel
      const [companiesResult, subsResult, productsResult] = await Promise.all([
        ctx.api.companies.list({ size: 200 }),
        ctx.api.subscriptions.list({ size: 1000 }),
        ctx.api.products.list({ size: 200 }),
      ]);

      // Build company name lookup
      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) {
        companyNames.set(c.id, c.name);
      }

      // Enrich subscriptions with company and product names
      const allSubs = subsResult.content;
      enrichCompanyNames(companyNames, allSubs);
      await enrichProductNames(ctx, allSubs);

      spinner.succeed("Dashboard loaded");
      const activeSubs = allSubs.filter((s) => s.status === "Active");
      let mrr = 0;
      let totalSeats = 0;
      const companyIds = new Set<string>();
      for (const sub of activeSubs) {
        const price = sub.price ?? 0;
        const qty = sub.quantity ?? 0;
        const term = String(sub.billingTerm ?? "Monthly");
        mrr += term.toLowerCase().includes("annual") ? (price * qty) / 12 : price * qty;
        totalSeats += qty;
        companyIds.add(sub.companyId);
      }

      // Renewals in next 30 days
      const renewals = getUpcomingRenewals(allSubs, 30);

      // Recommendations
      const recsReport = getRecommendations(
        activeSubs,
        productsResult.content,
      );
      const highRecs = recsReport.recommendations.filter((r) => r.priority === "high");

      // Trials
      const trials = allSubs.filter((s) => s.status === "Trial");

      // Compute per-company MRR for top customers
      const companyMrrMap = new Map<string, { name: string; mrr: number; seats: number; subs: number }>();
      for (const sub of activeSubs) {
        const coId = sub.companyId;
        const coName = sub.companyName ?? coId;
        const price = sub.price ?? 0;
        const qty = sub.quantity ?? 0;
        const term = String(sub.billingTerm ?? "Monthly");
        const subMrr = term.toLowerCase().includes("annual") ? (price * qty) / 12 : price * qty;

        const existing = companyMrrMap.get(coId) ?? { name: coName, mrr: 0, seats: 0, subs: 0 };
        existing.mrr += subMrr;
        existing.seats += qty;
        existing.subs += 1;
        companyMrrMap.set(coId, existing);
      }
      const topCustomers = [...companyMrrMap.values()]
        .sort((a, b) => b.mrr - a.mrr)
        .slice(0, 5);

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify({
          totalCompanies: companiesResult.page.totalElements,
          activeSubscriptions: activeSubs.length,
          companiesWithActiveSubs: companyIds.size,
          totalSeats,
          mrr: Number(mrr.toFixed(2)),
          arr: Number((mrr * 12).toFixed(2)),
          topCustomers: topCustomers.map((c) => ({
            name: c.name,
            mrr: Number(c.mrr.toFixed(2)),
            seats: c.seats,
            subscriptions: c.subs,
          })),
          renewalsNext30Days: renewals.items.length,
          urgentRenewals: renewals.urgentCount,
          mrrAtRisk: Number(renewals.totalMrrAtRisk.toFixed(2)),
          renewals: renewals.items.slice(0, 10).map((r) => ({
            companyName: r.companyName,
            productName: r.productName,
            daysUntilRenewal: r.daysUntilRenewal,
            mrrAtRisk: Number(r.mrrAtRisk.toFixed(2)),
          })),
          highPriorityRecs: highRecs.length,
          potentialMrrUplift: Number(highRecs.reduce((s, r) => s + (r.estimatedMrrUplift ?? 0), 0).toFixed(2)),
          activeTrials: trials.length,
        }, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      // Determine which sections to show
      const showAll = options.all;
      const showCustomers = showAll || options.customers;
      const showRenewals = showAll || options.renewals;
      const showGrowth = showAll || options.growth;
      const isDefault = !showCustomers && !showRenewals && !showGrowth;

      const arr = mrr * 12;
      const out = process.stdout;

      out.write("\n");
      out.write(chalk.bold("  Pax8 Business Snapshot\n\n"));

      // ── Revenue headline ─────────────────────────────────────────
      out.write(`  ${chalk.cyan.bold(formatCurrency(mrr))}/mo MRR  ·  ${chalk.cyan.bold(formatCurrency(arr))}/yr ARR\n\n`);
      out.write(`  ${chalk.dim("Companies:")}     ${companiesResult.page.totalElements}\n`);
      out.write(`  ${chalk.dim("Active subs:")}   ${activeSubs.length} across ${companyIds.size} companies\n`);
      out.write(`  ${chalk.dim("Total seats:")}   ${totalSeats.toLocaleString()}\n`);
      if (companyIds.size > 0) {
        out.write(`  ${chalk.dim("Avg MRR/co:")}    ${formatCurrency(mrr / companyIds.size)}\n`);
      }

      // ── Compact alerts (default mode) ────────────────────────────
      if (isDefault) {
        const alerts: string[] = [];

        if (renewals.urgentCount > 0) {
          alerts.push(
            chalk.red(`  ! ${renewals.urgentCount} renewal${renewals.urgentCount > 1 ? "s" : ""} due within 14d`) +
            chalk.dim(` — ${formatCurrency(renewals.totalMrrAtRisk)}/mo at risk`)
          );
        } else if (renewals.items.length > 0) {
          alerts.push(
            chalk.yellow(`  ! ${renewals.items.length} renewal${renewals.items.length > 1 ? "s" : ""} in next 30d`) +
            chalk.dim(` — ${formatCurrency(renewals.totalMrrAtRisk)}/mo at risk`)
          );
        }

        if (highRecs.length > 0) {
          const uplift = highRecs.reduce((s, r) => s + (r.estimatedMrrUplift ?? 0), 0);
          alerts.push(
            chalk.green(`  + ${highRecs.length} growth opportunit${highRecs.length > 1 ? "ies" : "y"}`) +
            chalk.green.bold(` — ${formatCurrency(uplift)}/mo potential`)
          );
        }

        if (trials.length > 0) {
          alerts.push(
            chalk.yellow(`  ~ ${trials.length} trial${trials.length > 1 ? "s" : ""}`) +
            chalk.dim(" to convert or cancel")
          );
        }

        if (alerts.length > 0) {
          out.write(`\n  ${chalk.dim("─".repeat(48))}\n\n`);
          for (const a of alerts) {
            out.write(a + "\n");
          }
        }

        // Top 3 action items
        interface ActionItem { urgency: number; line: string; cmd: string }
        const actions: ActionItem[] = [];

        for (const r of renewals.items.slice(0, 2)) {
          const days = r.daysUntilRenewal;
          const tag = days <= 7 ? chalk.red.bold(`${days}d`) : chalk.yellow(`${days}d`);
          actions.push({
            urgency: days,
            line: `${days <= 7 ? chalk.red("!") : chalk.yellow("!")} ${r.companyName} — ${r.productName} renews in ${tag}`,
            cmd: replCmd(`pax8 subscriptions renewals`),
          });
        }

        for (const t of trials.slice(0, 1)) {
          const trialCompany = String((t as Record<string, unknown>).companyName || (t as Record<string, unknown>).companyId);
          const trialProduct = String((t as Record<string, unknown>).productName || "product");
          actions.push({
            urgency: 10, // between renewals and growth
            line: `${chalk.yellow("~")} ${trialCompany} — ${trialProduct} trial expiring`,
            cmd: replCmd(`pax8 companies more "${trialCompany}"`),
          });
        }

        for (const r of highRecs.slice(0, 2)) {
          const upliftStr = r.estimatedMrrUplift ? chalk.green(` +${formatCurrency(r.estimatedMrrUplift)}/mo`) : "";
          actions.push({
            urgency: 100,
            line: `${chalk.green("+")} ${r.companyName} — ${r.suggestedProducts?.[0] ?? r.title}${upliftStr}`,
            cmd: replCmd(`pax8 recommendations list --company "${r.companyName}"`),
          });
        }

        actions.sort((a, b) => a.urgency - b.urgency);
        const top = actions.slice(0, 3);
        if (top.length > 0) {
          out.write(`\n  ${chalk.dim("─".repeat(48))}\n\n`);
          out.write(chalk.bold("  Next Steps\n\n"));
          for (const a of top) {
            out.write(`  ${a.line}\n`);
            out.write(chalk.dim(`    → ${a.cmd}\n`));
          }
        }

        if (alerts.length === 0 && top.length === 0) {
          out.write(chalk.green("\n  ✨ Everything looks good!\n"));
        }
      }

      // ── Top Customers (--customers / --all) ──────────────────────
      if (showCustomers && topCustomers.length > 0) {
        out.write(`\n  ${chalk.dim("─".repeat(48))}\n\n`);
        out.write(chalk.bold("  Top Customers\n\n"));
        const maxNameLen = Math.min(Math.max(...topCustomers.map((c) => c.name.length)), 28);
        for (const c of topCustomers) {
          const name = c.name.length > maxNameLen ? c.name.slice(0, maxNameLen - 1) + "\u2026" : c.name.padEnd(maxNameLen);
          const pct = mrr > 0 ? ` (${((c.mrr / mrr) * 100).toFixed(0)}%)` : "";
          out.write(`  ${chalk.bold(name)}  ${formatCurrency(c.mrr).padStart(12)}/mo  ${String(c.seats).padStart(5)} seats${chalk.dim(pct)}\n`);
        }
      }

      // ── Renewals (--renewals / --all) ────────────────────────────
      if (showRenewals && renewals.items.length > 0) {
        out.write(`\n  ${chalk.dim("─".repeat(48))}\n\n`);
        const urgent = renewals.items.filter((r) => r.daysUntilRenewal <= 14);
        const upcoming = renewals.items.filter((r) => r.daysUntilRenewal > 14);
        const header = urgent.length > 0
          ? `Renewals  ${chalk.red.bold(`${urgent.length} urgent`)}${upcoming.length > 0 ? chalk.dim(` · ${upcoming.length} upcoming`) : ""}`
          : `Renewals  ${chalk.yellow(`${renewals.items.length} in next 30d`)}`;
        out.write(chalk.bold(`  ${header}`) + chalk.dim(`  ${formatCurrency(renewals.totalMrrAtRisk)}/mo at risk\n\n`));
        for (const r of renewals.items.slice(0, 10)) {
          const days = r.daysUntilRenewal;
          const urgencyTag = days <= 7 ? chalk.red.bold(` ${days}d`) : days <= 14 ? chalk.yellow(` ${days}d`) : chalk.dim(` ${days}d`);
          out.write(`  ${days <= 7 ? chalk.red("!") : chalk.yellow("!")} ${r.companyName} — ${r.productName}${urgencyTag} ${chalk.dim(`(${formatCurrency(r.mrrAtRisk)}/mo)`)}\n`);
        }
        if (renewals.items.length > 10) {
          out.write(chalk.dim(`\n  … and ${renewals.items.length - 10} more\n`));
        }
        out.write(chalk.dim(`\n    → ${replCmd("pax8 subscriptions renewals")}\n`));
      }

      // ── Growth (--growth / --all) ────────────────────────────────
      if (showGrowth && highRecs.length > 0) {
        const uplift = highRecs.reduce((s, r) => s + (r.estimatedMrrUplift ?? 0), 0);
        out.write(`\n  ${chalk.dim("─".repeat(48))}\n\n`);
        out.write(chalk.bold(`  Growth Opportunities  `) + chalk.green.bold(`${formatCurrency(uplift)}/mo`) + chalk.dim(` potential uplift\n\n`));
        for (const r of highRecs.slice(0, 10)) {
          const upliftStr = r.estimatedMrrUplift ? chalk.green(` +${formatCurrency(r.estimatedMrrUplift)}/mo`) : "";
          out.write(`  ${chalk.green("+")} ${r.companyName} — ${r.title}${upliftStr}\n`);
        }
        if (highRecs.length > 10) {
          out.write(chalk.dim(`\n  … and ${highRecs.length - 10} more\n`));
        }
        out.write(chalk.dim(`\n    → ${replCmd("pax8 recommendations list")}\n`));
      }

      // ── Trials (shown in --all or if there are any and renewals/growth are shown) ──
      if (showAll && trials.length > 0) {
        out.write(`\n  ${chalk.dim("─".repeat(48))}\n\n`);
        out.write(chalk.bold(`  Active Trials  `) + chalk.yellow(`${trials.length} to convert or cancel\n\n`));
        for (const t of trials.slice(0, 5)) {
          out.write(`  ${chalk.yellow("~")} ${t.companyName || t.companyId} — ${t.productName || "Unknown product"}\n`);
        }
        if (trials.length > 5) {
          out.write(chalk.dim(`\n  … and ${trials.length - 5} more\n`));
        }
        out.write(chalk.dim(`\n    → ${replCmd("pax8 subscriptions list --status Trial")}\n`));
      }

      out.write("\n");
    } catch (error) {
      handleCommandError(error, spinner, "Failed to load status");
    }
  });
