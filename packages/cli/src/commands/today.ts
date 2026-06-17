// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import {
  auditInvoices,
  getRecommendations,
  getUpcomingRenewals,
  type AuditDiscrepancy,
  type Company,
  type InvoiceItem,
  type Product,
  type Recommendation,
  type RenewalItem,
  type Subscription,
} from "@pax8/core";
import { buildContext } from "../lib/context.js";
import { handleCommandError } from "../lib/errors.js";
import { createSpinner } from "../lib/spinner.js";
import { formatCurrency } from "../lib/formatters.js";
import { enrichCompanyNames, enrichProductNames } from "../lib/enrich-subscriptions.js";
import { discrepancyId } from "./invoices/dispute.js";
import { promptNextSteps, type NextStep } from "../lib/next-step.js";
import { collectSubsWithSpinner } from "../lib/subs-stream.js";
import { emitWarnings, type WarningRecord } from "../lib/aggregator-fetch.js";

// ── Item shape ────────────────────────────────────────────────────────────────

/**
 * Item kinds, ordered by the "lead with" rank used in both human and JSON
 * output. Composite cap of 10 is applied across all kinds combined; within a
 * kind, items are sorted by the per-kind rule documented on each builder
 * function below.
 *
 * Naming note: these match what the agent surfaces (CLAUDE.md, AGENTS.md,
 * skill.md) document. New kinds must be added to all four places.
 */
export type TodayItemKind =
  | "renewal-urgent"      // commitmentTerm.endDate ≤ 7 days
  | "audit-overcharge"    // invoice audit: partner billed more than active subs
  | "audit-undercharge"   // invoice audit: partner billed less than active subs
  | "growth-high"         // recommendation with priority="high"
  | "trial-expiring"      // Trial-status sub with renewalDate ≤ 14 days
  | "renewal-upcoming";   // commitmentTerm.endDate 8-30 days

type Priority = "high" | "medium" | "low";

export interface TodayItem {
  kind: TodayItemKind;
  priority: Priority;
  companyId?: string;
  companyName: string;
  /** Short, declarative item description. e.g. "Microsoft 365 BP renews in 3d" */
  summary: string;
  /**
   * Days until the event the item is about (renewal, trial end). Undefined for
   * non-time-anchored items (audit, growth).
   */
  daysUntil?: number;
  /**
   * Monthly revenue or cost exposure attached to the item. For renewals: the
   * sub's monthly Pax8 cost. For audit: the dollar impact (positive =
   * overcharge, negative = undercharge — caller surfaces sign via `kind`).
   * For growth: the estimated additional monthly Pax8 cost if acted on.
   * For trials: the monthly cost the trial would convert to.
   */
  monthlyImpact: { amount: number; currency: string };
  /**
   * One-shot action the partner can take to handle this item. Spawn
   * `args.slice(1)` directly — never tokenize `command`. Matches the #562
   * contract used everywhere else in the CLI.
   */
  action: { command: string; args: string[]; description: string };
}

// ── Data fetch ───────────────────────────────────────────────────────────────

export interface FetchedData {
  allSubs: Subscription[];
  companies: Company[];
  products: Product[];
  invoiceItems: InvoiceItem[];
  /**
   * Per-feed warnings collected during the parallel fetch. Returned as
   * structured data (rather than written directly to stderr) so this
   * helper is unit-testable in isolation. The command layer calls
   * `emitWarnings(process.stderr, data.warnings)` at the appropriate
   * point in the run sequence. See #635.
   */
  warnings: WarningRecord[];
}

export async function fetchAll(
  ctx: Awaited<ReturnType<typeof buildContext>>,
  spinner: ReturnType<typeof createSpinner>,
): Promise<FetchedData> {
  // Walk all subscription pages (post-#613) — `today` reasons about the full
  // portfolio just like `dashboard`. Companies and products stay on a single
  // page each: the former is only used as a name lookup, the latter feeds the
  // recommendations engine which caps at the documented 1000-product max.
  // Invoices fetch the most-recent page; line items follow.
  const [companiesSettled, productsSettled, invoicesSettled, subsSettled] =
    await Promise.allSettled([
      ctx.api.companies.list({ size: 200 }),
      ctx.api.products.list({ size: 1000 }),
      ctx.api.invoices.list({ size: 50 }),
      collectSubsWithSpinner(ctx.api.subscriptions.streamAll(), spinner, "today"),
    ]);

  const empty = { content: [] as never[], page: { number: 0, totalPages: 0, totalElements: 0 } };
  const companies = companiesSettled.status === "fulfilled" ? companiesSettled.value.content : [];
  const products = productsSettled.status === "fulfilled" ? productsSettled.value.content : [];
  const invoices = invoicesSettled.status === "fulfilled" ? invoicesSettled.value : empty;
  const allSubs = subsSettled.status === "fulfilled" ? subsSettled.value : [];

  // Collect partial-failure warnings as structured data so the partial-
  // failure logic is unit-testable. The command layer emits these via
  // `emitWarnings()` once the spinner has settled. We never throw here —
  // a single feed failure should still produce a partial brief — but
  // the partner needs to know the numbers are incomplete. Same pattern
  // as dashboard.ts (#635).
  const warnings: WarningRecord[] = [];
  if (companiesSettled.status === "rejected") {
    warnings.push({
      feed: "companies",
      severity: "warn",
      message: "Could not load companies — names may render as IDs",
    });
  }
  if (productsSettled.status === "rejected") {
    warnings.push({
      feed: "products",
      severity: "warn",
      message: "Could not load product catalog — growth opportunities suppressed",
    });
  }
  if (invoicesSettled.status === "rejected") {
    warnings.push({
      feed: "invoices",
      severity: "warn",
      message: "Could not load invoices — audit findings suppressed",
    });
  }
  if (subsSettled.status === "rejected") {
    // Subs are the primary feed (renewals + trials + audit normalization).
    // An empty result here is the single most-misleading shape — call it
    // out explicitly rather than rendering "all quiet."
    warnings.push({
      feed: "subscriptions",
      severity: "error",
      message: "Could not load subscriptions — today's list is incomplete",
    });
  }

  // Per-invoice items fetched after subs land so the spinner already
  // reflected the heavy fetch. Failures fall back to empty.
  const itemPages = await Promise.all(
    invoices.content.map((inv) =>
      ctx.api.invoices
        .listItems(inv.id, { size: 500 })
        .catch(() => ({ content: [] as InvoiceItem[] })),
    ),
  );
  const invoiceItems = itemPages.flatMap((p) => p.content);

  return { allSubs, companies, products, invoiceItems, warnings };
}

// ── Item builders ─────────────────────────────────────────────────────────────

function renewalCurrency(r: RenewalItem): string {
  return (r as RenewalItem & { currencyCode?: string }).currencyCode ?? "USD";
}

function buildRenewalItems(renewals: { items: RenewalItem[] }): {
  urgent: TodayItem[];
  upcoming: TodayItem[];
} {
  // Sort renewals ascending by days, tiebreak by descending dollar exposure.
  // The lead item must be the closest deadline; a tied-days item with bigger
  // exposure ranks above a smaller one.
  const sorted = [...renewals.items].sort((a, b) => {
    if (a.daysUntilRenewal !== b.daysUntilRenewal) {
      return a.daysUntilRenewal - b.daysUntilRenewal;
    }
    return b.mrrRenewing - a.mrrRenewing;
  });

  const urgent: TodayItem[] = [];
  const upcoming: TodayItem[] = [];

  for (const r of sorted) {
    const item: TodayItem = {
      kind: r.daysUntilRenewal <= 7 ? "renewal-urgent" : "renewal-upcoming",
      priority: r.daysUntilRenewal <= 3 ? "high" : r.daysUntilRenewal <= 14 ? "medium" : "low",
      companyId: r.companyId,
      companyName: r.companyName,
      summary: `${r.productName} renews in ${r.daysUntilRenewal}d`,
      daysUntil: r.daysUntilRenewal,
      monthlyImpact: { amount: Number(r.mrrRenewing.toFixed(2)), currency: renewalCurrency(r) },
      action: {
        command: `pax8 subscriptions renewals --within ${r.daysUntilRenewal <= 7 ? 7 : 30}d`,
        args: ["pax8", "subscriptions", "renewals", "--within", `${r.daysUntilRenewal <= 7 ? 7 : 30}d`],
        description: `Walk the renewal triage`,
      },
    };
    if (r.daysUntilRenewal <= 7) urgent.push(item);
    else upcoming.push(item);
  }

  return { urgent, upcoming };
}

interface StampedDiscrepancy extends AuditDiscrepancy {
  discrepancyId: string;
}

function buildAuditItems(
  discrepancies: StampedDiscrepancy[],
  currency: string,
): TodayItem[] {
  // Sort by absolute dollar impact descending. A $1,200 undercharge ranks
  // above a $300 overcharge — both are money on the floor, the bigger one
  // gets attention first.
  const sorted = [...discrepancies].sort(
    (a, b) => Math.abs(b.dollarImpact) - Math.abs(a.dollarImpact),
  );
  return sorted.map((d) => {
    const isOver = d.dollarImpact > 0;
    const verb = isOver ? "overcharge" : "undercharge";
    return {
      kind: isOver ? "audit-overcharge" : "audit-undercharge",
      priority: Math.abs(d.dollarImpact) >= 500 ? "high" : "medium",
      companyId: d.companyId,
      companyName: d.companyName,
      summary: `${formatCurrency(Math.abs(d.dollarImpact))} ${verb} on ${d.productName}`,
      monthlyImpact: { amount: Number(d.dollarImpact.toFixed(2)), currency },
      action: {
        command: `pax8 invoices dispute --discrepancy ${d.discrepancyId}`,
        args: ["pax8", "invoices", "dispute", "--discrepancy", d.discrepancyId],
        description: `File a dispute for ${d.companyName}`,
      },
    } satisfies TodayItem;
  });
}

function buildGrowthItems(
  highRecs: Recommendation[],
  currency: string,
): TodayItem[] {
  // Sort by estimatedMrrUplift DESC — concrete dollars first. Nulls last,
  // mirroring `recommendations list` (#521). Filtered to high-priority +
  // orderable upstream.
  const sorted = [...highRecs].sort((a, b) => {
    const au = a.estimatedMrrUplift ?? -Infinity;
    const bu = b.estimatedMrrUplift ?? -Infinity;
    return bu - au;
  });
  return sorted.map((r) => {
    const uplift = r.estimatedMrrUplift ?? 0;
    // Prefer `orderArgs.slice(1)` over re-tokenizing `orderCommand` — same
    // discipline as dashboard.ts. Fall back to a `recommendations list`
    // filter when no orderable product is matched.
    let args: string[];
    if (r.orderArgs && r.orderArgs[0] === "pax8") {
      args = r.orderArgs;
    } else {
      args = ["pax8", "recommendations", "list", "--company", r.companyName];
    }
    return {
      // kind="growth-high" means "from the high-priority recs section".
      // Pass through the source rec's priority — `highRecs` was already
      // filtered to `priority === "high"` upstream, so this is always
      // "high". Emitting "medium" here would mislead any agent filtering
      // `items[].priority === "high"` (the documented filter field).
      kind: "growth-high" as const,
      priority: "high" as const,
      companyId: r.companyId,
      companyName: r.companyName,
      summary: `add ${r.suggestedProducts?.[0] ?? r.title}`,
      monthlyImpact: { amount: Number(uplift.toFixed(2)), currency },
      action: {
        command: args.join(" "),
        args,
        description: `Place the order for ${r.companyName}`,
      },
    };
  });
}

function buildTrialItems(
  allSubs: Subscription[],
  currency: string,
): TodayItem[] {
  // Trials with an end date in the next 14 days. Demo fixture sometimes lacks
  // commitmentTerm on trials; those fall through silently — better than
  // surfacing a stale trial with no deadline.
  const now = Date.now();
  const cutoff = 14 * 24 * 60 * 60 * 1000;
  const items: TodayItem[] = [];
  for (const sub of allSubs) {
    if (sub.status !== "Trial") continue;
    // Subscription has `commitmentTermEndDate` (flat) + `commitment` (nested
     // CommitmentSchema with optional `endDate`). Renewal tracker uses both
     // because it accepts a more permissive Partial input shape; on real
     // Subscriptions we only have these two slots.
     const endDateRaw = sub.commitmentTermEndDate ?? sub.commitment?.endDate;
    if (!endDateRaw) continue;
    const endDate = new Date(endDateRaw).getTime();
    if (Number.isNaN(endDate)) continue;
    const ms = endDate - now;
    if (ms < 0 || ms > cutoff) continue;
    const daysUntil = Math.floor(ms / (24 * 60 * 60 * 1000));
    const monthly = (sub.price ?? 0) * (sub.quantity ?? 0);
    items.push({
      kind: "trial-expiring",
      priority: daysUntil <= 3 ? "high" : "medium",
      companyId: sub.companyId,
      companyName: sub.companyName ?? sub.companyId,
      summary: `${sub.productName ?? "trial"} trial ends in ${daysUntil}d`,
      daysUntil,
      monthlyImpact: { amount: Number(monthly.toFixed(2)), currency: sub.currencyCode ?? currency },
      action: {
        command: `pax8 subscriptions list --status Trial --company "${sub.companyName ?? sub.companyId}"`,
        args: ["pax8", "subscriptions", "list", "--status", "Trial", "--company", sub.companyName ?? sub.companyId],
        description: `Review the trial`,
      },
    });
  }
  // Soonest deadlines first.
  items.sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity));
  return items;
}

// ── Assembly ──────────────────────────────────────────────────────────────────

const TOTAL_CAP = 10;
// Three is the sweet spot for a "do today" list — partners can scan it
// without scrolling. The composite cap of 10 catches the long tail; for a
// fuller view, partners drill into the section-level commands shown under
// each block. (e.g. a portfolio with 50 urgent renewals shows 3 here + a
// "run subscriptions renewals --within 7d" hint.)
const PER_KIND_CAP = 3;

interface Sections {
  urgentRenewals: TodayItem[];
  audit: TodayItem[];
  growth: TodayItem[];
  trials: TodayItem[];
  upcomingRenewals: TodayItem[];
}

export interface AssembleResult {
  sections: Sections;
  flat: TodayItem[];
  /**
   * Items hidden across BOTH mechanisms — per-section cap + composite cap.
   * Used by the JSON `summary.truncated` field where consumers see the
   * canonical `items[]` (which is `flat`).
   */
  truncated: number;
  /**
   * Items hidden by ONLY the per-section cap. Used by the human render,
   * which iterates every section in full (up to PER_KIND_CAP each) — items
   * dropped by the composite cap are still visible on screen, so it would
   * over-count to surface `truncated` there.
   */
  perSectionTruncated: number;
}

export function assembleToday(input: {
  urgentRenewals: TodayItem[];
  upcomingRenewals: TodayItem[];
  audit: TodayItem[];
  growth: TodayItem[];
  trials: TodayItem[];
}): AssembleResult {
  // Cap each section to PER_KIND_CAP first so one runaway category can't
  // drown the others out (e.g. a partner with 50 high-priority recs
  // shouldn't lose visibility on the 3 urgent renewals due tomorrow).
  const sections: Sections = {
    urgentRenewals: input.urgentRenewals.slice(0, PER_KIND_CAP),
    audit: input.audit.slice(0, PER_KIND_CAP),
    growth: input.growth.slice(0, PER_KIND_CAP),
    trials: input.trials.slice(0, PER_KIND_CAP),
    upcomingRenewals: input.upcomingRenewals.slice(0, PER_KIND_CAP),
  };

  // Composite flat list in priority order. Urgent renewals lead; audit
  // findings next (silent money loss); growth third; trials fourth;
  // upcoming renewals last. Total cap of 10.
  const composite: TodayItem[] = [
    ...sections.urgentRenewals,
    ...sections.audit,
    ...sections.growth,
    ...sections.trials,
    ...sections.upcomingRenewals,
  ];
  const flat = composite.slice(0, TOTAL_CAP);
  // Two truncation counts: per-section vs total. The human path shows
  // every section item (up to PER_KIND_CAP each), so it only "loses"
  // items past the per-section cap. The JSON path returns `flat` and
  // loses items past EITHER cap.
  const perSectionTruncated =
    Math.max(0, input.urgentRenewals.length - PER_KIND_CAP) +
    Math.max(0, input.audit.length - PER_KIND_CAP) +
    Math.max(0, input.growth.length - PER_KIND_CAP) +
    Math.max(0, input.trials.length - PER_KIND_CAP) +
    Math.max(0, input.upcomingRenewals.length - PER_KIND_CAP);
  const compositeTruncated = composite.length - flat.length;
  const truncated = perSectionTruncated + compositeTruncated;
  return { sections, flat, truncated, perSectionTruncated };
}

// ── Header date ───────────────────────────────────────────────────────────────

function formatHeaderDate(now: Date): string {
  // "Thursday June 18" — gives partners running this daily an unambiguous
  // freshness signal without showing the year (the year is implicit; weekday
  // + month + day is the unique signature in a working memory).
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const month = now.toLocaleDateString("en-US", { month: "long" });
  const day = now.getDate();
  return `${weekday} ${month} ${day}`;
}

// ── Human render ─────────────────────────────────────────────────────────────

function renderHuman(
  out: NodeJS.WriteStream,
  sections: Sections,
  // Per-section truncation only — the human render shows every section
  // in full, so items dropped by the composite cap are still on screen
  // and must NOT be counted as hidden. JSON consumers use the larger
  // `summary.truncated` since they see `flat`, not the section breakdown.
  perSectionTruncated: number,
  context: { totalCompanies: number; activeSubs: number; portfolioMonthly: number; currency: string },
): void {
  const now = new Date();
  out.write("\n");
  out.write(chalk.bold("  Today") + chalk.dim(`  ·  ${formatHeaderDate(now)}\n\n`));

  const totalSurfaced =
    sections.urgentRenewals.length +
    sections.audit.length +
    sections.growth.length +
    sections.trials.length +
    sections.upcomingRenewals.length;

  if (totalSurfaced === 0) {
    // Clean-state alternate — honest acknowledgment, plus a pointer at the
    // full picture so partners aren't stranded with a literal blank screen.
    out.write(
      `  ${chalk.green("✨ All quiet.")}  ${context.totalCompanies} customer${context.totalCompanies !== 1 ? "s" : ""} · ` +
        `${formatCurrency(context.portfolioMonthly)}/mo · no urgent action.\n`,
    );
    out.write(chalk.dim(`     → pax8 dashboard --all for the full picture\n\n`));
    return;
  }

  // ── Urgent renewals ─────────────────────────────────────────────
  if (sections.urgentRenewals.length > 0) {
    const total = sections.urgentRenewals.reduce((s, i) => s + i.monthlyImpact.amount, 0);
    out.write(
      `  ${chalk.red.bold("🔴 Urgent")} — ${sections.urgentRenewals.length} renewal${
        sections.urgentRenewals.length > 1 ? "s" : ""
      } worth ${chalk.bold(formatCurrency(total))}/mo in the next 7 days\n`,
    );
    sections.urgentRenewals.forEach((item, i) => {
      out.write(
        `     ${chalk.dim(`${i + 1}.`)} ${chalk.bold(item.companyName)} — ${item.summary} ` +
          chalk.dim(`(${formatCurrency(item.monthlyImpact.amount)}/mo)`) +
          "\n",
      );
    });
    out.write(chalk.dim(`        → pax8 subscriptions renewals --within 7d\n\n`));
  }

  // ── Audit ───────────────────────────────────────────────────────
  if (sections.audit.length > 0) {
    const total = sections.audit.reduce((s, i) => s + Math.abs(i.monthlyImpact.amount), 0);
    out.write(
      `  ${chalk.yellow.bold("⚠ Money on the table")} — ${formatCurrency(total)} across ${
        sections.audit.length
      } invoice discrepanc${sections.audit.length > 1 ? "ies" : "y"}\n`,
    );
    sections.audit.forEach((item, i) => {
      out.write(
        `     ${chalk.dim(`${i + 1}.`)} ${chalk.bold(item.companyName)} — ${item.summary}\n`,
      );
    });
    out.write(chalk.dim(`        → pax8 invoices audit  ·  pax8 invoices dispute --discrepancy <id>\n\n`));
  }

  // ── Growth ──────────────────────────────────────────────────────
  if (sections.growth.length > 0) {
    const total = sections.growth.reduce((s, i) => s + i.monthlyImpact.amount, 0);
    out.write(
      `  ${chalk.green.bold("💰 Growth")} — ${sections.growth.length} high-priority opportunit${
        sections.growth.length > 1 ? "ies" : "y"
      }, ${chalk.green.bold(formatCurrency(total))}/mo uplift\n`,
    );
    sections.growth.forEach((item, i) => {
      const upliftStr = item.monthlyImpact.amount
        ? chalk.green(` (+${formatCurrency(item.monthlyImpact.amount)}/mo)`)
        : "";
      out.write(
        `     ${chalk.dim(`${i + 1}.`)} ${chalk.bold(item.companyName)} — ${item.summary}${upliftStr}\n`,
      );
    });
    out.write(chalk.dim(`        → pax8 recommendations act --priority high\n\n`));
  }

  // ── Trials ──────────────────────────────────────────────────────
  if (sections.trials.length > 0) {
    out.write(
      `  ${chalk.cyan.bold("⏳ Trials expiring")} — ${sections.trials.length} trial${
        sections.trials.length > 1 ? "s" : ""
      } end${sections.trials.length === 1 ? "s" : ""} within 14 days\n`,
    );
    sections.trials.forEach((item, i) => {
      out.write(
        `     ${chalk.dim(`${i + 1}.`)} ${chalk.bold(item.companyName)} — ${item.summary}\n`,
      );
    });
    out.write(chalk.dim(`        → pax8 subscriptions list --status Trial\n\n`));
  }

  // ── Upcoming renewals (demoted) ─────────────────────────────────
  if (sections.upcomingRenewals.length > 0) {
    const total = sections.upcomingRenewals.reduce((s, i) => s + i.monthlyImpact.amount, 0);
    out.write(
      `  ${chalk.dim("📅 Upcoming")} — ${sections.upcomingRenewals.length} renewal${
        sections.upcomingRenewals.length > 1 ? "s" : ""
      } in 8-30 days · ${chalk.dim(formatCurrency(total))}/mo\n`,
    );
    // `sections.upcomingRenewals` is already capped at PER_KIND_CAP by
    // assembleToday — no further slice needed here, and a "… and N more"
    // hint at this level would be unreachable. The full tail is surfaced
    // via the summary.truncated count + the section-level command below.
    sections.upcomingRenewals.forEach((item, i) => {
      out.write(
        `     ${chalk.dim(`${i + 1}.`)} ${item.companyName} — ${item.summary}\n`,
      );
    });
    out.write(chalk.dim(`        → pax8 subscriptions renewals --within 30d\n\n`));
  }

  // ── Truncation hint ─────────────────────────────────────────────
  if (perSectionTruncated > 0) {
    out.write(chalk.dim(`  … ${perSectionTruncated} more action${perSectionTruncated > 1 ? "s" : ""} not shown — run section-level commands above to see them.\n\n`));
  }

  // ── Closer line ─────────────────────────────────────────────────
  // One short warmth note. Phrasing rotates by section count so a partner
  // running this every morning doesn't see the same closer twice in a row.
  const actionCount =
    sections.urgentRenewals.length + sections.audit.length + sections.growth.length + sections.trials.length;
  const closer =
    actionCount === 0
      ? "Upcoming items only — nothing urgent today."
      : actionCount === 1
        ? "One thing to take care of today."
        : `${actionCount} things to take care of today.`;
  out.write(`  ${chalk.green("✨")} ${closer}\n\n`);
}

// ── Run ───────────────────────────────────────────────────────────────────────

async function runToday(options: Record<string, unknown>, cmd: Command): Promise<void> {
  const allOpts = cmd.optsWithGlobals();
  const ctx = await buildContext(allOpts);
  const spinner = createSpinner("Loading today's list...").start();

  try {
    const { allSubs, companies, products, invoiceItems, warnings } = await fetchAll(ctx, spinner);

    // Surface partial-failure warnings before the spinner succeeds so the
    // partner sees them in the same place as before the refactor (#635).
    // The fetch helper returns them as structured data; this layer owns
    // I/O.
    emitWarnings(process.stderr, warnings);

    // Enrich subs with company + product names so the human render reads as
    // names, not UUIDs. Cheap; the heavy lookups are cached per-process.
    const companyNames = new Map<string, string>();
    for (const c of companies) companyNames.set(c.id, c.name);
    enrichCompanyNames(companyNames, allSubs);
    await enrichProductNames(ctx, allSubs);

    spinner.succeed("Today's list ready");

    // Compute sources in pure-function form so the same data drives both
    // human and JSON renders.
    const activeSubs = allSubs.filter((s) => s.status === "Active");
    const renewals = getUpcomingRenewals(allSubs, 30);
    const { urgent: urgentRenewals, upcoming: upcomingRenewals } = buildRenewalItems(renewals);

    // Currency anchor for items that don't carry their own (audit, growth).
    // Mirrors dashboard.ts: read from the first active sub, default USD.
    const portfolioCurrency = activeSubs.find((s) => s.currencyCode)?.currencyCode ?? "USD";

    // Audit normalization — same flow as `invoices audit`. Match by
    // companyId+productId; the auditor doesn't get subscriptionId from
    // invoice items.
    const normalizedSubs = allSubs.map((s) => {
      const { id: _id, ...rest } = s;
      return { ...rest, subscriptionId: undefined, unitPrice: s.price };
    });
    const auditReport = auditInvoices(invoiceItems, normalizedSubs);
    const stamped: StampedDiscrepancy[] = auditReport.discrepancies.map((d) => ({
      ...d,
      discrepancyId: discrepancyId({
        companyId: d.companyId,
        productName: d.productName,
        type: d.type,
      }),
    }));
    const audit = buildAuditItems(stamped, portfolioCurrency);

    // Recommendations: high-priority only, orderable only.
    const recsReport = getRecommendations(activeSubs, products, companies);
    const highRecs = recsReport.recommendations
      .filter((r) => r.priority === "high")
      .filter((r) => r.productAvailable);
    const growth = buildGrowthItems(highRecs, portfolioCurrency);

    const trials = buildTrialItems(allSubs, portfolioCurrency);

    const { sections, flat, truncated, perSectionTruncated } = assembleToday({
      urgentRenewals,
      upcomingRenewals,
      audit,
      growth,
      trials,
    });

    // Portfolio context for the clean-state alternate.
    let portfolioMonthly = 0;
    for (const s of activeSubs) {
      const price = s.price ?? 0;
      const qty = s.quantity ?? 0;
      const term = String(s.billingTerm ?? "Monthly");
      portfolioMonthly += term === "Annual" ? (price * qty) / 12 : price * qty;
    }

    // ── JSON output ──────────────────────────────────────────────
    if (ctx.outputFormat === "json") {
      // Section counts MUST be derived from `flat` (the items array
      // actually emitted), not from `sections` (the pre-composite-cap
      // state). When the composite cap fires (e.g. 5 sections × 3 = 15
      // → sliced to 10), section.* counts can sum to more than
      // totalItems, and items[] would lack entries the section counts
      // imply exist. Agents reading the summary expect
      //   urgentRenewals + audit + growth + trials + upcoming === totalItems
      // and `items[].kind === "<x>"` to find exactly that many entries.
      const countKind = (kinds: TodayItemKind[]) =>
        flat.filter((i) => kinds.includes(i.kind)).length;
      const itemsByKind = (kinds: TodayItemKind[]) =>
        flat.filter((i) => kinds.includes(i.kind));

      const urgentRenewalsInFlat = itemsByKind(["renewal-urgent"]);
      const auditInFlat = itemsByKind(["audit-overcharge", "audit-undercharge"]);
      const growthInFlat = itemsByKind(["growth-high"]);
      const trialsInFlat = itemsByKind(["trial-expiring"]);

      const sumMonthly = (items: TodayItem[]) =>
        Number(items.reduce((s, i) => s + i.monthlyImpact.amount, 0).toFixed(2));
      const dollarsOnTable = Number(
        auditInFlat.reduce((s, i) => s + Math.abs(i.monthlyImpact.amount), 0).toFixed(2),
      );

      const nextActions: { command: string; args: string[]; description: string }[] = [];
      if (urgentRenewalsInFlat.length > 0) {
        nextActions.push({
          command: "pax8 subscriptions renewals --within 7d",
          args: ["pax8", "subscriptions", "renewals", "--within", "7d"],
          description: `Walk ${urgentRenewalsInFlat.length} urgent renewal${urgentRenewalsInFlat.length > 1 ? "s" : ""}`,
        });
      }
      if (auditInFlat.length > 0) {
        nextActions.push({
          command: "pax8 invoices audit",
          args: ["pax8", "invoices", "audit"],
          description: `Review ${auditInFlat.length} invoice discrepanc${auditInFlat.length > 1 ? "ies" : "y"}`,
        });
      }
      if (growthInFlat.length > 0) {
        nextActions.push({
          command: "pax8 recommendations act --priority high",
          args: ["pax8", "recommendations", "act", "--priority", "high"],
          description: `Walk ${growthInFlat.length} high-priority growth opportunit${growthInFlat.length > 1 ? "ies" : "y"}`,
        });
      }
      if (trialsInFlat.length > 0) {
        nextActions.push({
          command: "pax8 subscriptions list --status Trial",
          args: ["pax8", "subscriptions", "list", "--status", "Trial"],
          description: `Review ${trialsInFlat.length} expiring trial${trialsInFlat.length > 1 ? "s" : ""}`,
        });
      }

      const payload = {
        asOf: new Date().toISOString(),
        items: flat,
        summary: {
          totalItems: flat.length,
          urgentRenewals: urgentRenewalsInFlat.length,
          auditDiscrepancies: auditInFlat.length,
          growthOpportunities: growthInFlat.length,
          expiringTrials: trialsInFlat.length,
          upcomingRenewals: countKind(["renewal-upcoming"]),
          monthlyImpact: {
            amount: sumMonthly([...urgentRenewalsInFlat, ...growthInFlat]),
            currency: portfolioCurrency,
          },
          dollarsOnTable,
          truncated,
        },
        nextActions,
      };
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      return;
    }

    if (ctx.outputFormat === "quiet") return;

    // ── Human output ─────────────────────────────────────────────
    const out = process.stdout;
    renderHuman(out, sections, perSectionTruncated, {
      totalCompanies: companies.length,
      activeSubs: activeSubs.length,
      portfolioMonthly,
      currency: portfolioCurrency,
    });

    // ── REPL drill-in shortcuts ──────────────────────────────────
    // Wire each surfaced section to a single numbered shortcut keyed off
    // the section's lead command — the partner can press 1-N to jump into
    // the right follow-up. Per-item shortcuts get cluttered fast at the
    // composite cap of 10; one shortcut per section is the right rung.
    const steps: NextStep[] = [];
    if (sections.urgentRenewals.length > 0) {
      steps.push({
        key: String(steps.length + 1),
        label: `${chalk.red("!")} Walk ${sections.urgentRenewals.length} urgent renewal${sections.urgentRenewals.length > 1 ? "s" : ""}`,
        command: ["subscriptions", "renewals", "--within", "7d"],
      });
    }
    if (sections.audit.length > 0) {
      steps.push({
        key: String(steps.length + 1),
        label: `${chalk.yellow("⚠")} Open invoice audit`,
        command: ["invoices", "audit"],
      });
    }
    if (sections.growth.length > 0) {
      steps.push({
        key: String(steps.length + 1),
        label: `${chalk.green("+")} Act on ${sections.growth.length} growth opportunit${sections.growth.length > 1 ? "ies" : "y"}`,
        command: ["recommendations", "act", "--priority", "high"],
      });
    }
    if (sections.trials.length > 0) {
      steps.push({
        key: String(steps.length + 1),
        label: `${chalk.cyan("~")} Review expiring trials`,
        command: ["subscriptions", "list", "--status", "Trial"],
      });
    }
    if (steps.length > 0) {
      await promptNextSteps(steps, { renderList: true });
    }
  } catch (error) {
    await handleCommandError(error, spinner, "Failed to load today's list");
  }
}

export const todayCommand = new Command("today")
  .description("Your morning brief — the few things worth doing today")
  .addHelpText(
    "after",
    `
Examples:
  pax8 today
  pax8 today --json
  pax8 today --quiet

What's in it:
  - Urgent renewals (≤ 7 days) — time-critical revenue at risk
  - Invoice audit discrepancies — over- or undercharges to dispute
  - High-priority growth opportunities — closeable today via 'recommendations act'
  - Expiring trials (≤ 14 days) — convert or cancel
  - Upcoming renewals (8-30 days) — demoted, visible but not urgent

Composite cap: max 3 per section. JSON's items[] is further capped at
10 (composite cap) so agents always reason over the top-priority slice;
the human view renders every section in full (up to 3 each). Run the
section-level command shown under each block for the long tail.

JSON output (--json):
  Returns a composite envelope:

  {
    "asOf": string,                         // ISO-8601 timestamp
    "items": TodayItem[],                   // capped at 10, sorted by section priority
    "summary": {
      "totalItems": number,
      "urgentRenewals": number,
      "auditDiscrepancies": number,
      "growthOpportunities": number,
      "expiringTrials": number,
      "upcomingRenewals": number,
      "monthlyImpact": { "amount": number, "currency": string },
                                            // sum of urgent-renewal MRR + growth uplift across
                                            // items[]. Combined "monthly dollars in motion"
                                            // figure — distinct from dollarsOnTable which
                                            // captures one-time audit dollar impact only.
      "dollarsOnTable": number,             // sum of |dollarImpact| across audit items in items[]
      "truncated": number                   // items hidden by EITHER the per-section cap (max 3)
                                            // or the composite cap (max 10); drill into the
                                            // section-level command shown under each block.
    },
    "nextActions": [{ "command": string, "args": string[], "description": string }]
  }

  TodayItem = {
    "kind": "renewal-urgent" | "audit-overcharge" | "audit-undercharge"
           | "growth-high" | "trial-expiring" | "renewal-upcoming",
    "priority": "high" | "medium" | "low",
    "companyId": string,
    "companyName": string,
    "summary": string,
    "daysUntil": number,                    // present for renewal-* and trial-expiring
    "monthlyImpact": { "amount": number, "currency": string },
    "action": { "command": string, "args": string[], "description": string }
                                            // spawn args.slice(1) directly — never tokenize command (#562)
  }`,
  )
  .action(async (options: Record<string, unknown>, c: Command) => {
    await runToday(options, c);
  });
