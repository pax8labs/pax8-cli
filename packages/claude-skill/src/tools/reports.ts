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
}

interface Company {
  id: string;
  name: string;
}

export const pax8_report_mrr = {
  name: "pax8_report_mrr",
  description:
    "Calculate Monthly Recurring Revenue (MRR) with breakdown by company. Returns totalMRR, projectedARR, monthlyMRR, annualMRR_amortized, subscription counts, totalSeats, and a companiesByMRR array sorted descending with companyName, mrr, subscriptions, and seats. Pre-calculated — no follow-up calls needed. Optionally filter by companyId.",
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
    const subsArgs = ["subscriptions", "list", "--status", "Active", "--json", "--size", "1000"];
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

    // Compute MRR
    let totalMRR = 0;
    let monthlyMRR = 0;
    let annualMRR = 0;
    let monthlyCount = 0;
    let annualCount = 0;
    let totalSeats = 0;
    const byCompany: Record<string, { name: string; mrr: number; subs: number; seats: number }> = {};

    for (const sub of subs) {
      if (sub.status !== "Active") continue;
      const lineTotal = sub.price * sub.quantity;
      let mrr: number;

      if (sub.billingTerm === "Annual") {
        mrr = lineTotal / 12;
        annualMRR += mrr;
        annualCount++;
      } else {
        mrr = lineTotal;
        monthlyMRR += mrr;
        monthlyCount++;
      }

      totalMRR += mrr;
      totalSeats += sub.quantity;

      const cid = sub.companyId;
      if (!byCompany[cid]) {
        const name = sub.companyName || companyNames.get(cid) || cid.slice(0, 8);
        byCompany[cid] = { name, mrr: 0, subs: 0, seats: 0 };
      }
      byCompany[cid].mrr += mrr;
      byCompany[cid].subs++;
      byCompany[cid].seats += sub.quantity;
    }

    // Sort companies by MRR descending, include all
    const companiesByMrr = Object.entries(byCompany)
      .sort(([, a], [, b]) => b.mrr - a.mrr)
      .map(([id, data]) => ({
        companyId: id,
        companyName: data.name,
        mrr: Number(data.mrr.toFixed(2)),
        subscriptions: data.subs,
        seats: data.seats,
      }));

    return JSON.stringify({
      totalMRR: Number(totalMRR.toFixed(2)),
      projectedARR: Number((totalMRR * 12).toFixed(2)),
      monthlyMRR: Number(monthlyMRR.toFixed(2)),
      annualMRR_amortized: Number(annualMRR.toFixed(2)),
      monthlySubscriptions: monthlyCount,
      annualSubscriptions: annualCount,
      totalSubscriptions: monthlyCount + annualCount,
      totalSeats,
      companiesByMRR: companiesByMrr,
    }, null, 2);
  },
};
