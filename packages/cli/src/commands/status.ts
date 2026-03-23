import { Command } from "commander";
import chalk from "chalk";
import { buildContext, ALL_SUBS_SIZE } from "../lib/context.js";
import { createSpinner } from "../lib/spinner.js";
import { handleCommandError } from "../lib/errors.js";
import { formatCurrency, calculateMrr } from "../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../lib/enrich-subscriptions.js";
import { getUpcomingRenewals } from "@pax8/core";
import { getRecommendations } from "@pax8/core";
import type { Subscription } from "@pax8/core";
import { replCmd } from "../lib/confirm.js";
import { promptNextSteps, type NextStep } from "../lib/next-step.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface CompanyStats {
  name: string;
  mrr: number;
  seats: number;
  subs: number;
}

function computePortfolioStats(activeSubs: Subscription[]) {
  let mrr = 0;
  let totalSeats = 0;
  const companyIds = new Set<string>();
  const companyMap = new Map<string, CompanyStats>();

  for (const sub of activeSubs) {
    const price = sub.price ?? 0;
    const qty = sub.quantity ?? 0;
    const term = String(sub.billingTerm ?? "Monthly");
    const subMrr = calculateMrr(price, qty, term);

    mrr += subMrr;
    totalSeats += qty;
    companyIds.add(sub.companyId);

    const coId = sub.companyId;
    const existing = companyMap.get(coId) ?? { name: sub.companyName ?? coId, mrr: 0, seats: 0, subs: 0 };
    existing.mrr += subMrr;
    existing.seats += qty;
    existing.subs += 1;
    companyMap.set(coId, existing);
  }

  const topCustomers = [...companyMap.values()]
    .sort((a, b) => b.mrr - a.mrr)
    .slice(0, 5);

  return { mrr, totalSeats, companyIds, topCustomers };
}

function tokenizeCmd(cmd: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (const ch of cmd) {
    if (inQuote) {
      if (ch === quoteChar) { inQuote = false; }
      else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) { args.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

// ── Command ──────────────────────────────────────────────────────────────────

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
      const [companiesSettled, subsSettled, productsSettled] = await Promise.allSettled([
        ctx.api.companies.list({ size: 200 }),
        ctx.api.subscriptions.list({ size: ALL_SUBS_SIZE }),
        ctx.api.products.list({ size: 200 }),
      ]);

      const emptyPage = { number: 0, totalPages: 0, totalElements: 0 };
      const companiesResult = companiesSettled.status === 'fulfilled' ? companiesSettled.value : { content: [] as any[], page: { ...emptyPage } };
      const subsResult = subsSettled.status === 'fulfilled' ? subsSettled.value : { content: [] as any[], page: { ...emptyPage } };
      const productsResult = productsSettled.status === 'fulfilled' ? productsSettled.value : { content: [] as any[], page: { ...emptyPage } };

      if (companiesSettled.status === 'rejected') {
        process.stderr.write(chalk.yellow("  ⚠ Could not load companies\n"));
      }
      if (subsSettled.status === 'rejected') {
        process.stderr.write(chalk.yellow("  ⚠ Could not load subscriptions\n"));
      }
      if (productsSettled.status === 'rejected') {
        process.stderr.write(chalk.yellow("  ⚠ Could not load products\n"));
      }

      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) {
        companyNames.set(c.id, c.name);
      }

      const allSubs = subsResult.content;
      enrichCompanyNames(companyNames, allSubs);
      await enrichProductNames(ctx, allSubs);

      spinner.succeed("Dashboard loaded");

      const activeSubs = allSubs.filter((s) => s.status === "Active");
      const { mrr, totalSeats, companyIds, topCustomers } = computePortfolioStats(activeSubs);
      const renewals = getUpcomingRenewals(allSubs, 30);
      const recsReport = getRecommendations(activeSubs, productsResult.content);
      const highRecs = recsReport.recommendations.filter((r) => r.priority === "high");
      const trials = allSubs.filter((s) => s.status === "Trial");

      // ── JSON output ──────────────────────────────────────────────
      if (ctx.outputFormat === "json") {
        const nextActions: { command: string; description: string }[] = [];

        if (renewals.urgentCount > 0) {
          nextActions.push({
            command: "pax8 subscriptions renewals --json",
            description: `Review ${renewals.urgentCount} urgent renewal${renewals.urgentCount > 1 ? "s" : ""} (${formatCurrency(renewals.totalMrrAtRisk)}/mo at risk)`,
          });
        } else if (renewals.items.length > 0) {
          nextActions.push({
            command: "pax8 subscriptions renewals --json",
            description: `Review ${renewals.items.length} upcoming renewal${renewals.items.length > 1 ? "s" : ""}`,
          });
        }

        if (highRecs.length > 0) {
          nextActions.push({
            command: "pax8 recommendations list --json",
            description: `Explore ${highRecs.length} growth opportunit${highRecs.length > 1 ? "ies" : "y"} (${formatCurrency(highRecs.reduce((s, r) => s + (r.estimatedMrrUplift ?? 0), 0))}/mo potential)`,
          });
        }

        if (trials.length > 0) {
          nextActions.push({
            command: "pax8 subscriptions list --status Trial --json",
            description: `Review ${trials.length} active trial${trials.length > 1 ? "s" : ""} to convert or cancel`,
          });
        }

        // Add top customer drilldown
        if (topCustomers.length > 0) {
          nextActions.push({
            command: `pax8 companies more "${topCustomers[0].name}" --json`,
            description: `Drill into top customer ${topCustomers[0].name}`,
          });
        }

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
          nextActions,
        }, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      // ── Display flags ────────────────────────────────────────────
      const showAll = options.all;
      const showCustomers = showAll || options.customers;
      const showRenewals = showAll || options.renewals;
      const showGrowth = showAll || options.growth;
      const isDefault = !showCustomers && !showRenewals && !showGrowth;

      const arr = mrr * 12;
      const out = process.stdout;
      const divider = () => out.write(`\n  ${chalk.dim("─".repeat(48))}\n\n`);

      // ── Revenue headline ─────────────────────────────────────────
      out.write("\n");
      out.write(chalk.bold("  Pax8 Business Snapshot\n\n"));
      out.write(`  ${chalk.cyan.bold(formatCurrency(mrr))}/mo MRR  ·  ${chalk.cyan.bold(formatCurrency(arr))}/yr ARR\n\n`);
      out.write(`  ${chalk.dim("Companies:")}     ${companiesResult.page.totalElements}\n`);
      out.write(`  ${chalk.dim("Active subs:")}   ${activeSubs.length} across ${companyIds.size} companies\n`);
      out.write(`  ${chalk.dim("Total seats:")}   ${totalSeats.toLocaleString()}\n`);
      if (companyIds.size > 0) {
        out.write(`  ${chalk.dim("Avg MRR/co:")}    ${formatCurrency(mrr / companyIds.size)}\n`);
      }

      // ── Default mode: alerts + quick actions ─────────────────────
      if (isDefault) {
        const alerts: string[] = [];

        if (renewals.urgentCount > 0) {
          alerts.push(chalk.red(`  ! ${renewals.urgentCount} renewal${renewals.urgentCount > 1 ? "s" : ""} due within 14d`) + chalk.dim(` — ${formatCurrency(renewals.totalMrrAtRisk)}/mo at risk`));
        } else if (renewals.items.length > 0) {
          alerts.push(chalk.yellow(`  ! ${renewals.items.length} renewal${renewals.items.length > 1 ? "s" : ""} in next 30d`) + chalk.dim(` — ${formatCurrency(renewals.totalMrrAtRisk)}/mo at risk`));
        } else if (renewals.skippedNoDate > 0) {
          alerts.push(chalk.dim(`  ℹ ${renewals.skippedNoDate} subscription${renewals.skippedNoDate !== 1 ? "s" : ""} with no renewal date (likely month-to-month)`));
        }

        if (highRecs.length > 0) {
          const uplift = highRecs.reduce((s, r) => s + (r.estimatedMrrUplift ?? 0), 0);
          alerts.push(chalk.green(`  + ${highRecs.length} growth opportunit${highRecs.length > 1 ? "ies" : "y"}`) + chalk.green.bold(` — ${formatCurrency(uplift)}/mo potential`));
        }

        if (trials.length > 0) {
          alerts.push(chalk.yellow(`  ~ ${trials.length} trial${trials.length > 1 ? "s" : ""}`) + chalk.dim(" to convert or cancel"));
        }

        if (alerts.length > 0) {
          divider();
          for (const a of alerts) out.write(a + "\n");
        }

        // Build quick actions
        const quickActions: NextStep[] = [];

        // Renewals (dedupe by company)
        const seenCompanies = new Set<string>();
        for (const r of renewals.items) {
          if (seenCompanies.size >= 2) break;
          if (seenCompanies.has(r.companyId)) continue;
          seenCompanies.add(r.companyId);
          const days = r.daysUntilRenewal;
          const tag = days <= 7 ? chalk.red.bold(`${days}d`) : chalk.yellow(`${days}d`);
          const companyRenewals = renewals.items.filter((x) => x.companyId === r.companyId);
          const label = companyRenewals.length > 1
            ? `${r.companyName} — ${companyRenewals.length} subs renew in ${tag}`
            : `${r.companyName} — ${r.productName} renews in ${tag}`;
          quickActions.push({
            key: String(quickActions.length + 1),
            label: `${days <= 7 ? chalk.red("!") : chalk.yellow("!")} ${label}`,
            command: ["subscriptions", "renewals"],
          });
        }

        // Trials
        for (const t of trials.slice(0, 1)) {
          const coName = t.companyName || t.companyId;
          const prodName = t.productName || "product";
          quickActions.push({
            key: String(quickActions.length + 1),
            label: `${chalk.yellow("~")} ${coName} — ${prodName} trial expiring`,
            command: ["companies", "more", coName],
          });
        }

        // Growth recs — link directly to order when available
        for (const r of highRecs.slice(0, 2)) {
          const upliftStr = r.estimatedMrrUplift ? chalk.green(` +${formatCurrency(r.estimatedMrrUplift)}/mo`) : "";
          const cmd = r.orderCommand
            ? r.orderCommand.replace(/^pax8\s+/, "")
            : `recommendations list --company "${r.companyName}"`;
          quickActions.push({
            key: String(quickActions.length + 1),
            label: `${chalk.green("+")} ${r.companyName} — ${r.suggestedProducts?.[0] ?? r.title}${upliftStr}`,
            command: tokenizeCmd(cmd),
          });
        }

        if (quickActions.length > 0) {
          divider();
          out.write(chalk.bold("  Quick Actions\n\n"));
          await promptNextSteps(quickActions);
        }

        if (alerts.length === 0 && quickActions.length === 0) {
          out.write(chalk.green("\n  ✨ Everything looks good!\n"));
        }
      }

      // ── Top Customers (--customers / --all) ──────────────────────
      if (showCustomers && topCustomers.length > 0) {
        divider();
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
        divider();
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
        divider();
        out.write(chalk.bold(`  Growth Opportunities  `) + chalk.green.bold(`${formatCurrency(uplift)}/mo`) + chalk.dim(` potential uplift\n\n`));
        for (const r of highRecs.slice(0, 10)) {
          const upliftStr = r.estimatedMrrUplift ? chalk.green(` +${formatCurrency(r.estimatedMrrUplift)}/mo`) : "";
          out.write(`  ${chalk.green("+")} ${r.companyName} — ${r.title}${upliftStr}\n`);
        }
        if (highRecs.length > 10) {
          out.write(chalk.dim(`\n  … and ${highRecs.length - 10} more\n`));
        }
        out.write(chalk.dim(`\n    → ${replCmd("pax8 recommendations act")}  walk through and order\n`));
      }

      // ── Trials (--all only) ──────────────────────────────────────
      if (showAll && trials.length > 0) {
        divider();
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
