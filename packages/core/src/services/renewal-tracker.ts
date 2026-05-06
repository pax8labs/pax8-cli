// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Subscription } from "../api/types.js";
import { subscriptionMrr } from "./analytics.js";

/** The subset of Subscription fields used by the renewal tracker. */
type RenewalSubscriptionInput = Partial<Subscription> & {
  commitmentTerm?: { endDate?: string; billingTerm?: string };
  subscriptionId?: string;
};

export interface RenewalItem {
  subscriptionId: string;
  companyId: string;
  companyName: string;
  productName: string;
  quantity: number;
  renewalDate: Date;
  billingTerm: string;
  price: number;
  mrrAtRisk: number;
  daysUntilRenewal: number;
}

export interface RenewalReport {
  items: RenewalItem[];
  totalMrrAtRisk: number;
  annualCount: number;
  monthlyCount: number;
  urgentCount: number; // within 14 days
  skippedNoDate: number; // subscriptions with no commitmentTermEndDate
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.floor((utcB - utcA) / msPerDay);
}

/** @deprecated Use subscriptionMrr from analytics.ts — this alias exists for clarity in renewal context. */
const computeMrrAtRisk = subscriptionMrr;

export function getUpcomingRenewals(subscriptions: RenewalSubscriptionInput[], withinDays: number): RenewalReport {
  const now = new Date();
  const items: RenewalItem[] = [];
  let skippedNoDate = 0;

  for (const sub of subscriptions) {
    const endDateRaw = sub.commitmentTermEndDate ?? sub.commitmentTerm?.endDate;
    if (!endDateRaw) {
      skippedNoDate++;
      continue;
    }

    const renewalDate = new Date(endDateRaw);
    if (isNaN(renewalDate.getTime())) continue;

    const daysUntilRenewal = daysBetween(now, renewalDate);
    if (daysUntilRenewal < 0 || daysUntilRenewal > withinDays) continue;

    const billingTerm: string = sub.billingTerm ?? sub.commitmentTerm?.billingTerm ?? "Monthly";
    const price: number = sub.price ?? 0;
    const quantity: number = sub.quantity ?? 0;

    items.push({
      subscriptionId: sub.id ?? sub.subscriptionId ?? "",
      companyId: sub.companyId ?? "",
      companyName: sub.companyName ?? "",
      productName: sub.productName ?? "",
      quantity,
      renewalDate,
      billingTerm,
      price,
      mrrAtRisk: computeMrrAtRisk(price, quantity, billingTerm),
      daysUntilRenewal,
    });
  }

  // Sort by urgency (soonest first)
  items.sort((a, b) => a.daysUntilRenewal - b.daysUntilRenewal);

  const totalMrrAtRisk = items.reduce((sum, item) => sum + item.mrrAtRisk, 0);
  const annualCount = items.filter(
    (i) => i.billingTerm.toLowerCase().includes("annual") || i.billingTerm.toLowerCase().includes("yearly"),
  ).length;
  const monthlyCount = items.length - annualCount;
  const urgentCount = items.filter((i) => i.daysUntilRenewal <= 14).length;

  return {
    items,
    totalMrrAtRisk,
    annualCount,
    monthlyCount,
    urgentCount,
    skippedNoDate,
  };
}
