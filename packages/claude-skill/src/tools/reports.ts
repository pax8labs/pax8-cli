import { execCli } from "../index.js";

interface Subscription {
  companyId: string;
  productId: string;
  quantity: number;
  price: number;
  status: string;
  billingTerm: string;
}

interface PagedResponse {
  page: { size: number; totalElements: number; totalPages: number; number: number };
  content: Subscription[];
}

async function fetchAllActiveSubscriptions(companyId?: string): Promise<Subscription[]> {
  const baseArgs = ["subscriptions", "list", "--status", "Active", "--json", "--size", "200"];
  if (companyId) baseArgs.push("--company", companyId);

  // Fetch first page to get total pages
  const firstRaw = await execCli([...baseArgs, "--page", "0"]);
  let parsed: PagedResponse;
  try {
    parsed = JSON.parse(firstRaw);
  } catch {
    // CLI may return flat array (content only) in some modes
    const content = JSON.parse(firstRaw) as Subscription[];
    return content;
  }

  // If response has pagination info, fetch remaining pages
  if (parsed.page && parsed.content) {
    const allSubs = [...parsed.content];
    for (let p = 1; p < parsed.page.totalPages; p++) {
      const pageRaw = await execCli([...baseArgs, "--page", String(p)]);
      const pageParsed = JSON.parse(pageRaw) as PagedResponse;
      allSubs.push(...(pageParsed.content ?? []));
    }
    return allSubs;
  }

  return parsed.content ?? [];
}

export const pax8_report_mrr = {
  name: "pax8_report_mrr",
  description:
    "Calculate Monthly Recurring Revenue (MRR). Fetches ALL active subscriptions (paginated), computes totals, and returns a pre-calculated summary with MRR broken down by company. Much faster than listing raw subscriptions.",
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
    const subs = await fetchAllActiveSubscriptions(params.companyId);

    let totalMRR = 0;
    let monthlyMRR = 0;
    let annualMRR = 0;
    let monthlyCount = 0;
    let annualCount = 0;
    let totalSeats = 0;
    const byCompany: Record<string, { mrr: number; subs: number; seats: number }> = {};

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

      if (!byCompany[sub.companyId]) {
        byCompany[sub.companyId] = { mrr: 0, subs: 0, seats: 0 };
      }
      byCompany[sub.companyId].mrr += mrr;
      byCompany[sub.companyId].subs++;
      byCompany[sub.companyId].seats += sub.quantity;
    }

    // Sort companies by MRR descending
    const topCompanies = Object.entries(byCompany)
      .sort(([, a], [, b]) => b.mrr - a.mrr)
      .slice(0, 20)
      .map(([id, data]) => ({
        companyId: id,
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
      topCompaniesByMRR: topCompanies,
    }, null, 2);
  },
};
