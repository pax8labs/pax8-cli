// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Subscription, Invoice, BillingTerm } from "../api/types.js";

/**
 * Track which unknown `billingTerm` values we've already warned about so we
 * only emit a single stderr line per process per unknown value, regardless of
 * how many subscriptions carry it. Reset only by process restart.
 */
const unknownBillingTermsWarned = new Set<string>();

/** The subset of Subscription fields used by analytics. */
type AnalyticsSubscriptionInput = Partial<Subscription> & {
  vendorName?: string;
};

/** The subset of Invoice fields used by growth analytics. */
type AnalyticsInvoiceInput = Partial<Invoice> & {
  date?: string;
  amount?: number;
};

export interface MrrReport {
  totalMrr: number;
  byCompany: Array<{ companyId: string; companyName: string; mrr: number }>;
  byProduct: Array<{ productName: string; mrr: number; subscriptionCount: number }>;
  byVendor: Array<{ vendorName: string; mrr: number }>;
}

export interface GrowthReport {
  months: Array<{ month: string; mrr: number; delta: number; growthPercent: number }>;
  averageGrowth: number;
}

/**
 * Per-term monthly divisor. Keys are the canonical `BillingTermSchema` enum
 * values plus the defensive `"1-Year"` alias (Pax8 uses `"1-Year"` on
 * `commitment.term` and on some product-pricing rows; if it ever leaks into a
 * subscription's `billingTerm` we want to treat it as an annual commit, not
 * as an unknown-term gross figure).
 *
 * A value of `0` means the term contributes **zero** to monthly cost — used
 * for `One-Time`, `Trial`, and `Activation` line items, which are not
 * recurring revenue and were previously over-counted at full gross.
 *
 * Append-only. Adding a new `BillingTermSchema` value? Add it here too — the
 * TypeScript `Record<BillingTerm | "1-Year", ...>` constraint will block the
 * compile until you do.
 */
const BILLING_TERM_MONTHLY_DIVISOR: Record<BillingTerm | "1-Year", number> = {
  Monthly: 1,
  Annual: 12,
  "1-Year": 12,
  "2-Year": 24,
  "3-Year": 36,
  "One-Time": 0,
  Trial: 0,
  Activation: 0,
};

/**
 * Canonical lookup table keyed by lowercased term — call sites historically
 * pass lowercased / loosely-typed strings (e.g. `"annual"`, `"2-year"`), so
 * normalization happens here once.
 */
const BILLING_TERM_MONTHLY_DIVISOR_LOWER: Record<string, number> = Object.fromEntries(
  Object.entries(BILLING_TERM_MONTHLY_DIVISOR).map(([k, v]) => [k.toLowerCase(), v]),
);

/**
 * Calculate the Monthly Recurring Revenue contribution of a single
 * subscription.
 *
 * Pax8's `Subscription.billingTerm` is a closed enum (`BillingTermSchema`):
 * `Monthly`, `Annual`, `2-Year`, `3-Year`, `One-Time`, `Trial`, `Activation`.
 * Each multi-period term is divided down to its monthly equivalent. Match is
 * case-insensitive against the canonical enum value so callers may pass
 * lowercased / loosely-typed strings (the call sites in `computeMrr`,
 * `cost-simulator`, etc. do this). The `"1-Year"` alias is accepted for
 * defensive parity with `commitment.term`.
 *
 * **One-Time, Trial, and Activation contribute 0** to monthly cost — they're
 * not recurring. Previous behavior (#465) returned `price × quantity` for
 * these, which inflated every dashboard, recommendation, and report that
 * aggregated MRR. Reports that need the gross figure should sum `price ×
 * quantity` directly rather than going through this function.
 *
 * Unknown or falsy terms return 0 and emit a single-shot `stderr` warning
 * per unknown value per process. Silently returning gross was the original
 * bug — a future, unrecognized enum value would otherwise count at 12× /
 * 24× / 36× its true monthly rate.
 *
 * This is the single source of truth for MRR calculation across the
 * codebase.
 */
export function subscriptionMrr(price: number, quantity: number, billingTerm: string): number {
  const gross = price * quantity;
  const normalizedTerm = (billingTerm ?? "").toLowerCase();

  const divisor = BILLING_TERM_MONTHLY_DIVISOR_LOWER[normalizedTerm];
  if (divisor === undefined) {
    // Unknown / falsy billingTerm: zero contribution + one-shot warning so
    // partners aren't surprised by silent miscounting if Pax8 ever ships a
    // new enum value before we update this table.
    const key = normalizedTerm || "(empty)";
    if (!unknownBillingTermsWarned.has(key)) {
      unknownBillingTermsWarned.add(key);
      process.stderr.write(
        `[pax8] warn: unknown billingTerm "${billingTerm}"; contributing 0 to monthly cost.\n`,
      );
    }
    return 0;
  }
  if (divisor === 0) return 0;
  return gross / divisor;
}

export function computeMrr(subscriptions: AnalyticsSubscriptionInput[]): MrrReport {
  const activeSubs = subscriptions.filter(
    (s) => (s.status ?? "").toLowerCase() === "active",
  );

  let totalMrr = 0;

  const companyMap = new Map<string, { companyId: string; companyName: string; mrr: number }>();
  const productMap = new Map<string, { productName: string; mrr: number; subscriptionCount: number }>();
  const vendorMap = new Map<string, { vendorName: string; mrr: number }>();

  for (const sub of activeSubs) {
    const mrr = subscriptionMrr(sub.price ?? 0, sub.quantity ?? 1, (sub.billingTerm ?? "monthly"));
    totalMrr += mrr;

    const companyId: string = sub.companyId ?? "";
    const companyName: string = sub.companyName ?? "";
    const existing = companyMap.get(companyId);
    if (existing) {
      existing.mrr += mrr;
    } else {
      companyMap.set(companyId, { companyId, companyName, mrr });
    }

    const productName: string = sub.productName ?? "";
    const prodEntry = productMap.get(productName);
    if (prodEntry) {
      prodEntry.mrr += mrr;
      prodEntry.subscriptionCount += 1;
    } else {
      productMap.set(productName, { productName, mrr, subscriptionCount: 1 });
    }

    const vendorName: string = sub.vendorName ?? "";
    const vendorEntry = vendorMap.get(vendorName);
    if (vendorEntry) {
      vendorEntry.mrr += mrr;
    } else {
      vendorMap.set(vendorName, { vendorName, mrr });
    }
  }

  return {
    totalMrr,
    byCompany: Array.from(companyMap.values()).sort((a, b) => b.mrr - a.mrr),
    byProduct: Array.from(productMap.values()).sort((a, b) => b.mrr - a.mrr),
    byVendor: Array.from(vendorMap.values()).sort((a, b) => b.mrr - a.mrr),
  };
}

export function computeGrowth(invoices: AnalyticsInvoiceInput[], months: number): GrowthReport {
  // Group invoices by month (YYYY-MM)
  const monthlyTotals = new Map<string, number>();

  for (const inv of invoices) {
    const dateStr: string = inv.invoiceDate ?? inv.date ?? "";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) continue;

    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const total: number = inv.total ?? inv.amount ?? 0;
    monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) ?? 0) + total);
  }

  // Sort months and take the last N
  const sortedMonths = Array.from(monthlyTotals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-months);

  const result: GrowthReport["months"] = [];
  let previousMrr = 0;

  for (let i = 0; i < sortedMonths.length; i++) {
    const [month, mrr] = sortedMonths[i];
    const delta = i === 0 ? 0 : mrr - previousMrr;
    const growthPercent = i === 0 || previousMrr === 0 ? 0 : (delta / previousMrr) * 100;

    result.push({ month, mrr, delta, growthPercent });
    previousMrr = mrr;
  }

  const growthEntries = result.filter((_, i) => i > 0);
  const averageGrowth =
    growthEntries.length > 0
      ? growthEntries.reduce((sum, e) => sum + e.growthPercent, 0) / growthEntries.length
      : 0;

  return {
    months: result,
    averageGrowth,
  };
}
