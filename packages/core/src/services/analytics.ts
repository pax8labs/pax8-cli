// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Subscription, Invoice } from "../api/types.js";

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
 * Calculate the Monthly Recurring Revenue for a single subscription.
 *
 * Pax8's `Subscription.billingTerm` is a closed enum (`BillingTermSchema`):
 * `Monthly`, `Annual`, `2-Year`, `3-Year`, `One-Time`, `Trial`, `Activation`.
 * Each multi-period term is divided down to its monthly equivalent. The match
 * is case-insensitive against the canonical enum value so callers may pass
 * lowercased / loosely-typed strings (the call sites in `computeMrr`,
 * `cost-simulator`, etc. do this).
 *
 * `One-Time`, `Trial`, `Activation`, and unknown / falsy values fall through
 * to `price × quantity` — preserving the pre-fix default. Reworking those
 * semantics is a separate question (they aren't really "recurring") and is
 * intentionally out of scope here.
 *
 * This is the single source of truth for MRR calculation across the codebase.
 */
export function subscriptionMrr(price: number, quantity: number, billingTerm: string): number {
  const gross = price * quantity;
  const normalizedTerm = (billingTerm ?? "").toLowerCase();

  switch (normalizedTerm) {
    case "monthly":
      return gross;
    case "annual":
      return gross / 12;
    case "2-year":
      return gross / 24;
    case "3-year":
      return gross / 36;
    case "one-time":
    case "trial":
    case "activation":
      return gross;
    default:
      // Unknown / falsy billingTerm: preserve historical behavior (treat as
      // monthly) so callers passing `undefined`, `""`, or future enum values
      // we don't yet recognize don't suddenly start under-reporting MRR.
      return gross;
  }
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
