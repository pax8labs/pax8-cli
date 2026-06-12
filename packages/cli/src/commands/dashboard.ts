// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../lib/context.js";
import { createSpinner } from "../lib/spinner.js";
import { handleCommandError } from "../lib/errors.js";
import { formatCurrency, calculateMrr, formatTimeAgo } from "../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../lib/enrich-subscriptions.js";
import { getUpcomingRenewals } from "@pax8/core";
import { getRecommendations } from "@pax8/core";
import type { Subscription, Company, Product, Order, RenewalReport, Recommendation, PaginatedResponse } from "@pax8/core";
import { replCmd } from "../lib/confirm.js";
import { promptNextSteps, type NextStep } from "../lib/next-step.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Materialize every page of subscriptions from a `streamAll()` iterator
 * into a single array. Used by dashboard (and Phase 2 — the other three
 * aggregator commands) to get the full portfolio without the silent
 * page-limit truncation #613 was tracking.
 *
 * Calls `onProgress(loaded, total)` after each page so the caller can
 * keep its spinner honest on large portfolios. `total` is read from the
 * first page's `page.totalElements` and held stable across the iteration
 * (the server reports the same value on every page).
 *
 * The future `pax8 subscriptions export` command will consume the same
 * `streamAll()` iterator directly — writing each page to stdout/file as
 * it arrives without materializing. This helper exists because dashboard
 * needs the full array for its multi-pass computations
 * (`computePortfolioStats`, `getUpcomingRenewals`, `getRecommendations`,
 * trial/active filters); export does not.
 */
async function collectAllSubscriptions(
  stream: AsyncIterableIterator<PaginatedResponse<Subscription>>,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Subscription[]> {
  const all: Subscription[] = [];
  for await (const result of stream) {
    all.push(...result.content);
    onProgress?.(all.length, result.page.totalElements);
  }
  return all;
}

// Internal name `cost` reflects what these numbers actually are: the
// partner's monthly cost to Pax8 (price × quantity, amortized monthly).
// Previously framed as partner-side "MRR" — corrected per the reporting-
// domain review: these are wholesale costs paid to Pax8, not partner-side
// resale revenue. The math is unchanged; the labels and the CLI's own JSON
// field names are.
interface CompanyStats {
  name: string;
  cost: number;
  seats: number;
  subs: number;
}

function computePortfolioStats(activeSubs: Subscription[]) {
  let cost = 0;
  let totalSeats = 0;
  const companyIds = new Set<string>();
  const companyMap = new Map<string, CompanyStats>();

  for (const sub of activeSubs) {
    const price = sub.price ?? 0;
    const qty = sub.quantity ?? 0;
    const term = String(sub.billingTerm ?? "Monthly");
    const subCost = calculateMrr(price, qty, term);

    cost += subCost;
    totalSeats += qty;
    companyIds.add(sub.companyId);

    const coId = sub.companyId;
    const existing = companyMap.get(coId) ?? { name: sub.companyName ?? coId, cost: 0, seats: 0, subs: 0 };
    existing.cost += subCost;
    existing.seats += qty;
    existing.subs += 1;
    companyMap.set(coId, existing);
  }

  const topCustomers = [...companyMap.values()]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5);

  return { cost, totalSeats, companyIds, topCustomers };
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
  totalCost: number,
  divider: () => void,
): void {
  if (topCustomers.length === 0) return;
  divider();
  out.write(chalk.bold("  Top Customers by Pax8 Monthly Cost\n\n"));
  const maxNameLen = Math.min(Math.max(...topCustomers.map((c) => c.name.length)), 28);
  const maxCost = topCustomers[0]?.cost ?? 0;
  const barWidth = 18;
  for (const c of topCustomers) {
    const name = c.name.length > maxNameLen ? c.name.slice(0, maxNameLen - 1) + "…" : c.name.padEnd(maxNameLen);
    const pctNum = totalCost > 0 ? ((c.cost / totalCost) * 100) : 0;
    const pctStr = `${pctNum.toFixed(0)}%`;
    const { bar, len } = brailleBar(c.cost, maxCost, barWidth);
    const pad = barWidth - len;
    out.write(`  ${chalk.bold(name)}  ${formatCurrency(c.cost).padStart(10)}/mo  ${chalk.cyan(bar)}${chalk.dim("⠀".repeat(pad))}  ${chalk.dim(pctStr.padStart(4))}\n`);
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
  // Wording note: "uplift" here is the additional Pax8 monthly cost to the
  // partner if these recs were ordered (unit price × seats). It is not the
  // partner's resale revenue.
  out.write(chalk.bold(`  Growth Opportunities  `) + chalk.green.bold(`${formatCurrency(uplift)}/mo`) + chalk.dim(` potential Pax8 cost uplift\n\n`));
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

async function runDashboard(options: { all?: boolean; customers?: boolean; renewals?: boolean; growth?: boolean }, cmd: Command): Promise<void> {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Loading dashboard...").start();

    try {
      // Fetch companies/products/orders in parallel with the subscription
      // stream. Subscriptions are the heaviest resource and now walk every
      // page via `streamAll()` (#613) so partners with >1000 subs no longer
      // get silently truncated portfolio totals. The other three resources
      // stay single-page — none of dashboard's outputs grow with their
      // count past the first 200 (companies are used as a name lookup,
      // products for recommendations enrichment, orders for the recent-
      // activity window).
      const [companiesSettled, productsSettled, ordersSettled, subsSettled] = await Promise.allSettled([
        ctx.api.companies.list({ size: 200 }),
        ctx.api.products.list({ size: 200 }),
        ctx.api.orders.list({ size: 200 }),
        collectAllSubscriptions(ctx.api.subscriptions.streamAll(), (loaded, total) => {
          if (total > 1000) {
            // Only update the spinner when there's a real portfolio to
            // count down — small portfolios load fast enough that the
            // running-tally text just flickers.
            spinner.text = `Loading dashboard... (${loaded.toLocaleString()} of ${total.toLocaleString()} subscriptions)`;
          }
        }),
      ]);

      const emptyPage = { number: 0, totalPages: 0, totalElements: 0 };
      const companiesResult = companiesSettled.status === 'fulfilled' ? companiesSettled.value : { content: [] as Company[], page: { ...emptyPage } };
      const productsResult = productsSettled.status === 'fulfilled' ? productsSettled.value : { content: [] as Product[], page: { ...emptyPage } };
      const ordersResult = ordersSettled.status === 'fulfilled' ? ordersSettled.value : { content: [] as Order[], page: { ...emptyPage } };
      const allSubs: Subscription[] = subsSettled.status === 'fulfilled' ? subsSettled.value : [];

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

      enrichCompanyNames(companyNames, allSubs);
      await enrichProductNames(ctx, allSubs);

      spinner.succeed("Dashboard loaded");

      // Recent orders (today)
      const today = new Date().toISOString().slice(0, 10);
      const recentOrders = ordersResult.content
        .filter((o) => o.createdAt.startsWith(today))
        .map((o) => ({
          ...o,
          companyName: (o as Record<string, unknown>).companyName as string
            ?? companyNames.get(o.companyId)
            ?? o.companyId,
        }));

      const activeSubs = allSubs.filter((s) => s.status === "Active");
      const { cost, totalSeats, companyIds, topCustomers } = computePortfolioStats(activeSubs);
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
            description: `Explore ${highRecs.length} growth opportunit${highRecs.length > 1 ? "ies" : "y"} (${formatCurrency(highRecs.reduce((s, r) => s + (r.estimatedMrrUplift ?? 0), 0))}/mo additional Pax8 cost)`,
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
            command: `pax8 clients more "${topCustomers[0].name}" --json`,
            description: `Drill into top customer ${topCustomers[0].name}`,
          });
        }

        // JSON field-naming note: the dollar figures here are the partner's
        // monthly/annual COST to Pax8 (sum of price × quantity across active
        // subs, amortized monthly). Emitted as wrapped `AmountCurrency`
        // envelopes ({ amount, currency }) — the canonical Pax8 wire shape
        // used by the v2 quoting API (`QuoteResponse.totals.initialCost`,
        // etc., schema at `packages/core/src/api/types.ts`). Surface-
        // consistent with the reporting commands (`report renewals` /
        // `concentration` / `subscriptions`).
        // Currency is read from `Subscription.currencyCode` on the underlying
        // subs (first active sub for aggregates), defaulting to "USD" when
        // missing. Mixed-currency portfolios are out of scope for v0.x.
        const portfolioCurrency = activeSubs.find((s) => s.currencyCode)?.currencyCode ?? "USD";
        const portfolioMonthlyCost = Number(cost.toFixed(2));
        const portfolioAnnualCost = Number((cost * 12).toFixed(2));
        const potentialUplift = Number(highRecs.reduce((s, r) => s + (r.estimatedMrrUplift ?? 0), 0).toFixed(2));
        process.stdout.write(JSON.stringify({
          totalCompanies: companiesResult.page.totalElements,
          activeSubscriptions: activeSubs.length,
          companiesWithActiveSubs: companyIds.size,
          totalSeats,
          monthlyCost: { amount: portfolioMonthlyCost, currency: portfolioCurrency },
          annualCost: { amount: portfolioAnnualCost, currency: portfolioCurrency },
          topCustomers: topCustomers.map((c) => {
            const customerCost = Number(c.cost.toFixed(2));
            return {
              name: c.name,
              monthlyCost: { amount: customerCost, currency: portfolioCurrency },
              seats: c.seats,
              subscriptions: c.subs,
            };
          }),
          renewalsNext30Days: renewals.items.length,
          urgentRenewals: renewals.urgentCount,
          // `mrrRenewing` is the canonical name (#298). Wire-side partner-
          // risk framing field, preserved flat (not part of the
          // AmountCurrency reshape).
          mrrRenewing: Number(renewals.totalMrrRenewing.toFixed(2)),
          renewals: renewals.items.slice(0, 10).map((r) => {
            const mrr = Number(r.mrrRenewing.toFixed(2));
            return {
              companyName: r.companyName,
              productName: r.productName,
              daysUntilRenewal: r.daysUntilRenewal,
              mrrRenewing: mrr,
            };
          }),
          highPriorityRecs: highRecs.length,
          potentialMonthlyUplift: { amount: potentialUplift, currency: portfolioCurrency },
          activeTrials: trials.length,
          recentOrders: recentOrders.map((o) => ({
            companyName: o.companyName,
            status: o.status,
            createdAt: o.createdAt,
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

      const annualCost = cost * 12;
      const out = process.stdout;
      const divider = () => out.write(`\n  ${chalk.dim("─".repeat(48))}\n\n`);

      // ── Pax8 cost headline ───────────────────────────────────────
      // These figures are partner cost paid to Pax8 (sum of price ×
      // quantity across active subs, amortized monthly). They are NOT
      // partner-side MRR / ARR — that distinction was previously elided
      // in the headline and got flagged in the reporting-domain review.
      out.write("\n");
      out.write(chalk.bold("  Pax8 Business Snapshot\n\n"));
      out.write(`  ${chalk.cyan.bold(formatCurrency(cost))}/mo Pax8 cost  ·  ${chalk.cyan.bold(formatCurrency(annualCost))}/yr annualized\n\n`);
      out.write(`  ${chalk.dim("Companies:")}     ${companiesResult.page.totalElements}\n`);
      out.write(`  ${chalk.dim("Active subs:")}   ${activeSubs.length} across ${companyIds.size} companies\n`);
      out.write(`  ${chalk.dim("Total seats:")}   ${totalSeats.toLocaleString()}\n`);
      if (companyIds.size > 0) {
        out.write(`  ${chalk.dim("Avg Pax8 cost/co:")} ${formatCurrency(cost / companyIds.size)}\n`);
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
          const ago = formatTimeAgo(new Date(o.createdAt));
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
          alerts.push(chalk.green(`  + ${highRecs.length} growth opportunit${highRecs.length > 1 ? "ies" : "y"}`) + chalk.green.bold(` — ${formatCurrency(uplift)}/mo potential Pax8 cost`));
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
            command: ["clients", "more", coName],
          });
        }

        // Growth recs — link directly to order when available.
        // #509: prefer the structured `orderArgs.slice(1)` over re-tokenizing
        // the display `orderCommand` string. Names with shell metacharacters
        // (AT&T, "O'Brien & Sons", etc.) survive intact as single argv
        // elements; the tokenizer round-trip is avoided.
        for (const r of highRecs.slice(0, 2)) {
          const upliftStr = r.estimatedMrrUplift ? chalk.green(` +${formatCurrency(r.estimatedMrrUplift)}/mo`) : "";
          let command: string[];
          if (r.orderArgs && r.orderArgs[0] === "pax8") {
            command = r.orderArgs.slice(1);
          } else if (r.orderCommand) {
            command = tokenizeCmd(r.orderCommand.replace(/^pax8\s+/, ""));
          } else {
            command = tokenizeCmd(`recommendations list --company "${r.companyName}"`);
          }
          quickActions.push({
            key: String(quickActions.length + 1),
            label: `${chalk.green("+")} ${r.companyName} — ${r.suggestedProducts?.[0] ?? r.title}${upliftStr}`,
            command,
          });
        }

        if (quickActions.length > 0) {
          divider();
          out.write(chalk.bold("  Quick Actions\n\n"));
          await promptNextSteps(quickActions, { renderList: true });
        }

        if (alerts.length === 0 && quickActions.length === 0) {
          out.write(chalk.green("\n  ✨ Everything looks good!\n"));
        }
      }

      // ── Top Customers (--customers / --all) ──────────────────────
      if (showCustomers) {
        renderCustomersSection(out, topCustomers, cost, divider);
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
            command: tokenizeCmd(`clients more "${topCustomers[0].name}"`),
          });
        }

        if (allActions.length > 0) {
          divider();
          out.write(chalk.bold("  Quick Actions\n\n"));
          await promptNextSteps(allActions, { renderList: true });
        }
      }

      out.write("\n");
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to load dashboard");
    }
}

export const dashboardCommand = new Command("dashboard")
  .description("Quick snapshot of your Pax8 business")
  .option("--all", "Show full dashboard with all sections")
  .option("--customers", "Show top customers by Pax8 monthly cost")
  .option("--renewals", "Show upcoming renewal details")
  .option("--growth", "Show growth opportunities")
  .addHelpText(
    "after",
    `
Examples:
  pax8 dashboard
  pax8 dashboard --all
  pax8 dashboard --customers
  pax8 dashboard --renewals --growth
  pax8 dashboard --json

JSON output (--json):
  Pax8-cost figures are emitted as wrapped AmountCurrency envelopes
  ({ amount, currency }) — the canonical Pax8 wire shape used by the v2
  quoting API. Currency is sourced from Subscription.currencyCode on the
  underlying subs (defaults to "USD" when missing).

  {
    "totalCompanies": number,
    "activeSubscriptions": number,
    "companiesWithActiveSubs": number,
    "totalSeats": number,
    "monthlyCost": { "amount": number, "currency": string },   // sum of price × quantity (monthly-amortized) for active subs
    "annualCost": { "amount": number, "currency": string },    // monthlyCost.amount × 12
    "topCustomers": [{
      "name": string,
      "monthlyCost": { "amount": number, "currency": string },
      "seats": number,
      "subscriptions": number
    }],
    "renewalsNext30Days": number,
    "urgentRenewals": number,             // renewals within 14d
    "mrrRenewing": number,                // partner-risk framing, preserved flat
    "renewals": [{
      "companyName": string,
      "productName": string,
      "daysUntilRenewal": number,
      "mrrRenewing": number
    }],
    "highPriorityRecs": number,
    "potentialMonthlyUplift": { "amount": number, "currency": string }, // additional Pax8 monthly cost across high-priority recs
    "activeTrials": number,
    "recentOrders": [{
      "companyName": string,
      "status": string,
      "createdAt": string,                // ISO-8601
      "lineItems": [{ "productName": string, "quantity": number }]
    }],
    "nextActions": [{ "command": string, "description": string }]
  }

Note: Numbers shown are Pax8 cost — what Pax8 charges you. For partner revenue (what you charge your customers), combine with sell-through pricing from your PSA.`,
  )
  .action(async (options: { all?: boolean; customers?: boolean; renewals?: boolean; growth?: boolean }, c: Command) => {
    await runDashboard(options, c);
  });
