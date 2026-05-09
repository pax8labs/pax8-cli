// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext, warnIfTruncated } from "../lib/context.js";
import { createSpinner } from "../lib/spinner.js";
import { handleCommandError } from "../lib/errors.js";
import { formatCurrency, calculateMrr, formatTimeAgo } from "../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../lib/enrich-subscriptions.js";
import { ALL_SUBS_PAGE_SIZE, getUpcomingRenewals } from "@pax8/core";
import { getRecommendations } from "@pax8/core";
import type { Subscription, Company, Product, Order, RenewalReport, Recommendation } from "@pax8/core";
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

function brailleBar(value: number, max: number, width: number): { bar: string; len: number } {
  const full = "⣿"; // ⣿ (both columns)
  const half = "⡇"; // ⡇ (left column only)
  const ratio = max > 0 ? value / max : 0;
  const filled = ratio * width * 2; // 2 sub-positions per character
  const wholeChars = Math.floor(filled / 2);
  const hasHalf = Math.round(filled) % 2 === 1;
  const len = wholeChars + (hasHalf && wholeChars < width ? 1 : 0);
  const bar = full.repeat(wholeChars) + (hasHalf && wholeChars < width ? half : "");
  return { bar, len };
}

// ── Section renderers ─────────────────────────────────────────────────────────

function renderCustomersSection(
  out: NodeJS.WriteStream,
  topCustomers: CompanyStats[],
  mrr: number,
  divider: () => void,
): void {
  if (topCustomers.length === 0) return;
  divider();
  out.write(chalk.bold("  Top Customers\n\n"));
  const maxNameLen = Math.min(Math.max(...topCustomers.map((c) => c.name.length)), 28);
  const maxMrr = topCustomers[0]?.mrr ?? 0;
  const barWidth = 18;
  for (const c of topCustomers) {
    const name = c.name.length > maxNameLen ? c.name.slice(0, maxNameLen - 1) + "…" : c.name.padEnd(maxNameLen);
    const pctNum = mrr > 0 ? ((c.mrr / mrr) * 100) : 0;
    const pctStr = `${pctNum.toFixed(0)}%`;
    const { bar, len } = brailleBar(c.mrr, maxMrr, barWidth);
    const pad = barWidth - len;
    out.write(`  ${chalk.bold(name)}  ${formatCurrency(c.mrr).padStart(10)}/mo  ${chalk.cyan(bar)}${chalk.dim("⠀".repeat(pad))}  ${chalk.dim(pctStr.padStart(4))}\n`);
  }
}

function renderRenewalsSection(
  out: NodeJS.WriteStream,
  renewals: RenewalReport,
  divider: () => void,
): void {
  if (renewals.items.length === 0) return;
  divider();
  const urgent = renewals.items.filter((r) => r.daysUntilRenewal <= 14);
  const upcoming = renewals.items.filter((r) => r.daysUntilRenewal > 14);
  const header = urgent.length > 0
    ? `Renewals  ${chalk.red.bold(`${urgent.length} urgent`)}${upcoming.length > 0 ? chalk.dim(` · ${upcoming.length} upcoming`) : ""}`
    : `Renewals  ${chalk.yellow(`${renewals.items.length} in next 30d`)}`;
  out.write(chalk.bold(`  ${header}`) + chalk.dim(`  ${formatCurrency(renewals.totalMrrRenewing)}/mo renewing\n\n`));
  for (const r of renewals.items.slice(0, 10)) {
    const days = r.daysUntilRenewal;
    const urgencyTag = days <= 7 ? chalk.red.bold(` ${days}d`) : days <= 14 ? chalk.yellow(` ${days}d`) : chalk.dim(` ${days}d`);
    out.write(`  ${days <= 7 ? chalk.red("!") : chalk.yellow("!")} ${r.companyName} — ${r.productName}${urgencyTag} ${chalk.dim(`(${formatCurrency(r.mrrRenewing)}/mo)`)}\n`);
  }
  if (renewals.items.length > 10) {
    out.write(chalk.dim(`\n  … and ${renewals.items.length - 10} more\n`));
  }
  out.write(chalk.dim(`\n    → ${replCmd("pax8 subscriptions renewals")}\n`));
}

function renderGrowthSection(
  out: NodeJS.WriteStream,
  highRecs: Recommendation[],
  divider: () => void,
): void {
  if (highRecs.length === 0) return;
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

// ── Command ──────────────────────────────────────────────────────────────────

// The dashboard handler is extracted so the canonical `dashboard` command and
// the deprecated `status` alias share the same implementation; the alias is
// just a thin wrapper that prints a stderr deprecation notice before invoking
// `runDashboard()`. Will be removed in v1.0 (mirrors the `--events` → `--topics`
// deprecation in `pax8 webhooks create`).
async function runDashboard(options: { all?: boolean; customers?: boolean; renewals?: boolean; growth?: boolean }, cmd: Command): Promise<void> {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Loading dashboard...").start();

    try {
      const [companiesSettled, subsSettled, productsSettled, ordersSettled] = await Promise.allSettled([
        ctx.api.companies.list({ size: 200 }),
        ctx.api.subscriptions.list({ size: ALL_SUBS_PAGE_SIZE }),
        ctx.api.products.list({ size: 200 }),
        ctx.api.orders.list({ size: 200 }),
      ]);

      const emptyPage = { number: 0, totalPages: 0, totalElements: 0 };
      const companiesResult = companiesSettled.status === 'fulfilled' ? companiesSettled.value : { content: [] as Company[], page: { ...emptyPage } };
      const subsResult = subsSettled.status === 'fulfilled' ? subsSettled.value : { content: [] as Subscription[], page: { ...emptyPage } };
      const productsResult = productsSettled.status === 'fulfilled' ? productsSettled.value : { content: [] as Product[], page: { ...emptyPage } };
      const ordersResult = ordersSettled.status === 'fulfilled' ? ordersSettled.value : { content: [] as Order[], page: { ...emptyPage } };

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

      warnIfTruncated(subsResult, ALL_SUBS_PAGE_SIZE);

      const allSubs = subsResult.content;
      enrichCompanyNames(companyNames, allSubs);
      await enrichProductNames(ctx, allSubs);

      spinner.succeed("Dashboard loaded");

      // Recent orders (today)
      const today = new Date().toISOString().slice(0, 10);
      const recentOrders = ordersResult.content
        .filter((o) => o.createdDate.startsWith(today))
        .map((o) => ({
          ...o,
          companyName: (o as Record<string, unknown>).companyName as string
            ?? companyNames.get(o.companyId)
            ?? o.companyId,
        }));

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
            description: `Review ${renewals.urgentCount} urgent renewal${renewals.urgentCount > 1 ? "s" : ""} (${formatCurrency(renewals.totalMrrRenewing)}/mo renewing)`,
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
          // `mrrRenewing` is the canonical name introduced in #298. The
          // `mrrAtRisk` alias is kept for one minor version cycle so existing
          // scripts don't break.
          mrrRenewing: Number(renewals.totalMrrRenewing.toFixed(2)),
          mrrAtRisk: Number(renewals.totalMrrRenewing.toFixed(2)),
          renewals: renewals.items.slice(0, 10).map((r) => {
            const mrr = Number(r.mrrRenewing.toFixed(2));
            return {
              companyName: r.companyName,
              productName: r.productName,
              daysUntilRenewal: r.daysUntilRenewal,
              mrrRenewing: mrr,
              mrrAtRisk: mrr,
            };
          }),
          highPriorityRecs: highRecs.length,
          potentialMrrUplift: Number(highRecs.reduce((s, r) => s + (r.estimatedMrrUplift ?? 0), 0).toFixed(2)),
          activeTrials: trials.length,
          recentOrders: recentOrders.map((o) => ({
            companyName: o.companyName,
            status: o.status,
            createdDate: o.createdDate,
            lineItems: o.lineItems?.map(
              (li: { productId: string; productName?: string; quantity: number }) => ({
                productName: li.productName ?? li.productId,
                quantity: li.quantity,
              }),
            ),
          })),
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
      out.write(`  ${chalk.cyan.bold(formatCurrency(mrr))}/mo estimated MRR  ·  ${chalk.cyan.bold(formatCurrency(arr))}/yr ARR\n\n`);
      out.write(`  ${chalk.dim("Companies:")}     ${companiesResult.page.totalElements}\n`);
      out.write(`  ${chalk.dim("Active subs:")}   ${activeSubs.length} across ${companyIds.size} companies\n`);
      out.write(`  ${chalk.dim("Total seats:")}   ${totalSeats.toLocaleString()}\n`);
      if (companyIds.size > 0) {
        out.write(`  ${chalk.dim("Avg est. MRR/co:")} ${formatCurrency(mrr / companyIds.size)}\n`);
      }

      // ── Recent Activity ──────────────────────────────────────────
      if (recentOrders.length > 0) {
        divider();
        out.write(chalk.bold("  Recent Activity\n\n"));
        for (const o of recentOrders.slice(0, 5)) {
          const items = o.lineItems ?? [];
          const productDesc = items.length > 0
            ? items.map(
                (li: { productName?: string; quantity: number }) => {
                  const name = li.productName ?? "product";
                  return `${name} (${li.quantity} seats)`;
                },
              ).join(", ")
            : "order placed";
          const ago = formatTimeAgo(new Date(o.createdDate));
          out.write(`  ${chalk.green("✓")} ${o.companyName} — ${productDesc}  ${chalk.dim(ago)}\n`);
        }
      }

      // ── Default mode: alerts + quick actions ─────────────────────
      if (isDefault) {
        const alerts: string[] = [];

        if (renewals.urgentCount > 0) {
          alerts.push(chalk.red(`  ! ${renewals.urgentCount} renewal${renewals.urgentCount > 1 ? "s" : ""} due within 14d`) + chalk.dim(` — ${formatCurrency(renewals.totalMrrRenewing)}/mo renewing`));
        } else if (renewals.items.length > 0) {
          alerts.push(chalk.yellow(`  ! ${renewals.items.length} renewal${renewals.items.length > 1 ? "s" : ""} in next 30d`) + chalk.dim(` — ${formatCurrency(renewals.totalMrrRenewing)}/mo renewing`));
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
      if (showCustomers) {
        renderCustomersSection(out, topCustomers, mrr, divider);
      }

      // ── Renewals (--renewals / --all) ────────────────────────────
      if (showRenewals) {
        renderRenewalsSection(out, renewals, divider);
      }

      // ── Growth (--growth / --all) ────────────────────────────────
      if (showGrowth) {
        renderGrowthSection(out, highRecs, divider);
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

      // ── Quick Actions (--all) ─────────────────────────────────────
      if (showAll) {
        const allActions: NextStep[] = [];

        if (renewals.items.length > 0) {
          allActions.push({
            key: String(allActions.length + 1),
            label: `${chalk.yellow("!")} ${renewals.items.length} renewal${renewals.items.length > 1 ? "s" : ""} in the next 30 days`,
            command: ["subscriptions", "renewals"],
          });
        }

        if (highRecs.length > 0) {
          allActions.push({
            key: String(allActions.length + 1),
            label: `${chalk.green("+")} Walk through ${highRecs.length} growth opportunities`,
            command: ["recommendations", "act"],
          });
        }

        if (topCustomers.length > 0) {
          allActions.push({
            key: String(allActions.length + 1),
            label: `Drill into ${topCustomers[0].name}`,
            command: tokenizeCmd(`companies more "${topCustomers[0].name}"`),
          });
        }

        if (allActions.length > 0) {
          divider();
          out.write(chalk.bold("  Quick Actions\n\n"));
          await promptNextSteps(allActions);
        }
      }

      out.write("\n");
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to load dashboard");
    }
}

// One-line stderr deprecation notice for the legacy `status` alias. Mirrors
// the `--events`/`--topics` deprecation pattern (#274). Will be removed in v1.0.
const STATUS_DEPRECATION_NOTICE =
  "warning: `status` is deprecated; use `dashboard`. Will be removed in v1.0.\n";

function buildDashboardCommand(name: "dashboard" | "status"): Command {
  const cmd = new Command(name)
    .description("Quick snapshot of your Pax8 business")
    .option("--all", "Show full dashboard with all sections")
    .option("--customers", "Show top customers by estimated MRR")
    .option("--renewals", "Show upcoming renewal details")
    .option("--growth", "Show growth opportunities")
    .addHelpText(
      "after",
      `
Examples:
  pax8 ${name}
  pax8 ${name} --all
  pax8 ${name} --customers
  pax8 ${name} --renewals --growth
  pax8 ${name} --json`,
    )
    .action(async (options: { all?: boolean; customers?: boolean; renewals?: boolean; growth?: boolean }, c: Command) => {
      if (name === "status") {
        process.stderr.write(STATUS_DEPRECATION_NOTICE);
      }
      await runDashboard(options, c);
    });

  if (name === "status") {
    // Commander short-circuits `--help` before running .action(), so the
    // deprecation notice is also emitted as a beforeAll help-text hook so
    // `pax8 status --help` still surfaces the notice on stderr. The hook
    // returns "" (no extra help-text content) — its sole purpose is the
    // side-effect of writing to stderr.
    cmd.addHelpText("beforeAll", () => {
      process.stderr.write(STATUS_DEPRECATION_NOTICE);
      return "";
    });
  }

  return cmd;
}

export const dashboardCommand = buildDashboardCommand("dashboard");

// Deprecated alias. Registered with `{ hidden: true }` in src/index.ts so it
// does not appear in `pax8 --help`. Removal tracked for v1.0.
export const statusCommand = buildDashboardCommand("status");
