// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { execCli } from "../index.js";

interface Subscription {
  companyId: string;
  companyName?: string;
  productId: string;
  productName?: string;
  quantity: number;
  price: number;
  status: string;
  billingTerm: string;
  currencyCode?: string;
}

interface Company {
  id: string;
  name: string;
}

/**
 * Standardized partner-revenue disclaimer string. Quoted verbatim from
 * `packages/cli/src/commands/report/*` (#440 / #443) and the dashboard
 * AmountCurrency reshape. This is embedded in the JSON payload (not just a
 * docstring) so an agent consuming this tool sees the framing — `--help`
 * footers don't apply here since the consumer is JSON-only.
 */
const DISCLAIMER =
  "Numbers shown are Pax8 cost — what Pax8 charges you. For partner revenue (what you charge your customers), combine with sell-through pricing from your PSA.";

/**
 * Per-subscription monthly Pax8 cost. Mirrors the canonical
 * `subscriptionMrr` from `@pax8/core` (`packages/core/src/services/analytics.ts`)
 * — duplicated here only because the claude-skill package is intentionally
 * dependency-free (it shells to the CLI rather than importing core directly).
 * Case-insensitive switch on the canonical `BillingTerm` enum values:
 * `Monthly` / `Annual` / `2-Year` / `3-Year`, with `One-Time` / `Trial` /
 * `Activation` and unknown values falling through to `price × quantity`.
 *
 * Pre-#439 bug to NOT regress: substring matching on `"annual"` / `"yearly"`
 * let multi-year terms fall through to the monthly default, double-counting
 * 2-Year / 3-Year commitments.
 */
function monthlyCostOf(
  price: number,
  quantity: number,
  billingTerm: string,
): number {
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
      return gross;
  }
}

export const pax8_report_subscriptions = {
  name: "pax8_report_subscriptions",
  description:
    "Compute the partner's Pax8 cost rollup across active subscriptions, grouped by company. Returns `totalMonthlyCost` and `totalAnnualCost` as wrapped `AmountCurrency` objects ({ amount, currency }), plus a `companiesByMonthlyCost` array sorted descending with companyId, companyName, monthlyCost, subscriptionCount, and totalSeats. This is the partner's cost paid to Pax8 — NOT partner-side resale revenue. Includes the standard partner-revenue disclaimer in the payload. Pre-calculated; no follow-up calls needed. Optionally filter by companyId. NOTE: divergence from the `pax8 report subscriptions` CLI command — that command supports `--by customer|vendor|product|billing-term`; this skill tool returns a fixed by-company rollup.",
  parameters: {
    type: "object" as const,
    properties: {
      companyId: {
        type: "string",
        description:
          "Filter to a specific company ID (UUID). Optional — omit for all companies.",
      },
    },
  },
  execute: async (params: { companyId?: string }) => {
    // Fetch subscriptions and companies in parallel — single CLI call each
    const subsArgs = [
      "subscriptions",
      "list",
      "--status",
      "Active",
      "--json",
      "--size",
      "1000",
    ];
    if (params.companyId) subsArgs.push("--company", params.companyId);

    const [subsRaw, companiesRaw] = await Promise.all([
      execCli(subsArgs),
      execCli(["companies", "list", "--json", "--size", "200"]),
    ]);

    // Parse — CLI outputs either { page, content } or flat array
    let subs: Subscription[];
    try {
      const parsed = JSON.parse(subsRaw);
      subs = Array.isArray(parsed) ? parsed : (parsed.content ?? []);
    } catch {
      subs = [];
    }

    let companies: Company[];
    try {
      const parsed = JSON.parse(companiesRaw);
      companies = Array.isArray(parsed) ? parsed : (parsed.content ?? []);
    } catch {
      companies = [];
    }

    // Build company name lookup
    const companyNames = new Map<string, string>();
    for (const c of companies) {
      companyNames.set(c.id, c.name);
    }

    // Compute Pax8 cost rollup
    const activeSubs = subs.filter((sub) => sub.status === "Active");
    const portfolioCurrency =
      activeSubs.find((s) => s.currencyCode)?.currencyCode ?? "USD";

    let totalMonthlyCost = 0;
    let totalSeats = 0;
    const byCompany: Record<
      string,
      { name: string; monthlyCost: number; subscriptionCount: number; totalSeats: number }
    > = {};

    for (const sub of activeSubs) {
      const monthlyCost = monthlyCostOf(sub.price, sub.quantity, sub.billingTerm);
      totalMonthlyCost += monthlyCost;
      totalSeats += sub.quantity;

      const cid = sub.companyId;
      if (!byCompany[cid]) {
        const name = sub.companyName || companyNames.get(cid) || cid.slice(0, 8);
        byCompany[cid] = {
          name,
          monthlyCost: 0,
          subscriptionCount: 0,
          totalSeats: 0,
        };
      }
      byCompany[cid].monthlyCost += monthlyCost;
      byCompany[cid].subscriptionCount += 1;
      byCompany[cid].totalSeats += sub.quantity;
    }

    // Sort companies by monthly cost descending, include all
    const companiesByMonthlyCost = Object.entries(byCompany)
      .sort(([, a], [, b]) => b.monthlyCost - a.monthlyCost)
      .map(([id, data]) => ({
        companyId: id,
        companyName: data.name,
        monthlyCost: {
          amount: Number(data.monthlyCost.toFixed(2)),
          currency: portfolioCurrency,
        },
        subscriptionCount: data.subscriptionCount,
        totalSeats: data.totalSeats,
      }));

    return JSON.stringify(
      {
        totalActiveSubscriptions: activeSubs.length,
        totalMonthlyCost: {
          amount: Number(totalMonthlyCost.toFixed(2)),
          currency: portfolioCurrency,
        },
        totalAnnualCost: {
          amount: Number((totalMonthlyCost * 12).toFixed(2)),
          currency: portfolioCurrency,
        },
        totalSeats,
        companiesByMonthlyCost,
        disclaimer: DISCLAIMER,
      },
      null,
      2,
    );
  },
};
