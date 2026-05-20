// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";
import { subscriptionMrr } from "@pax8/core";

export function formatTimeAgo(date: Date | string): string {
  const now = new Date();
  const then = typeof date === "string" ? new Date(date) : date;
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${diffYears}y ago`;
}

/**
 * Render a money amount with the correct currency unit.
 *
 * Pre-#472 this hard-coded `"$"`, which mislabeled every EUR / GBP / CAD
 * partner's subscriptions in the dashboard, top-customers table, cost
 * simulator, and recommendations view. The `subscriptions list` table had a
 * workaround that appended `" EUR"` per row; that suffix is dropped in favor
 * of this single source of truth.
 *
 * Implementation: `Intl.NumberFormat` with `style: "currency"` so the
 * runtime picks the correct symbol (or trailing ISO code) for the locale.
 * Always two fraction digits to keep table alignment stable.
 *
 * @param amount Numeric amount in the major unit (e.g. dollars, not cents).
 * @param currencyCode ISO-4217 code (default `"USD"`). Falls back to `"USD"`
 *   when callers pass an empty string or `undefined` — preserves the legacy
 *   "default to dollars" behavior at every call site that hasn't yet
 *   threaded the real `currencyCode` from the upstream record.
 */
export function formatCurrency(amount: number, currencyCode: string = "USD"): string {
  const code = (currencyCode && currencyCode.trim()) || "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Unknown / malformed ISO-4217 code: fall back to a plain numeric render
    // with the code as a suffix so the unit isn't silently dropped.
    const abs = Math.abs(amount);
    const formatted = abs.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return amount < 0 ? `-${formatted} ${code}` : `${formatted} ${code}`;
  }
}

export function formatQuantity(n: number): string {
  return `${n} seat${n !== 1 ? "s" : ""}`;
}

export function formatStatus(status: string | undefined): string {
  if (!status) return chalk.gray("  —");
  const normalized = status.toLowerCase();

  if (normalized === "active") {
    return chalk.green("✓ Active");
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return chalk.red("✗ Cancelled");
  }
  if (normalized === "trial") {
    return chalk.yellow("● Trial");
  }
  if (normalized.startsWith("pending")) {
    return chalk.yellow(`● ${status}`);
  }
  return chalk.gray(`  ${status}`);
}

export function formatCompanyName(
  name: string,
  maxLen: number = 25
): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + "…";
}

export function formatDate(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function calculateMrr(price: number, quantity: number, billingTerm: string): number {
  return Number(subscriptionMrr(price, quantity, billingTerm).toFixed(2));
}

export function formatDaysUntil(date: string | Date): string {
  const now = new Date();
  const target = typeof date === "string" ? new Date(date) : date;

  // Strip time for day-level comparison
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  );

  const diffMs = targetDay.getTime() - nowDay.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays === -1) return "yesterday";

  if (diffDays > 0) {
    if (diffDays < 30) return `in ${diffDays} days`;
    const months = Math.round(diffDays / 30);
    return `in ${months} month${months !== 1 ? "s" : ""}`;
  }

  // Past
  const absDays = Math.abs(diffDays);
  if (absDays < 30) return `${absDays} days ago`;
  const months = Math.round(absDays / 30);
  return `${months} month${months !== 1 ? "s" : ""} ago`;
}
