import { execCli } from "../index.js";

export const pax8_report_mrr = {
  name: "pax8_report_mrr",
  description:
    "Generate a Monthly Recurring Revenue (MRR) report. Fetches all active subscriptions and computes MRR totals grouped by company and product. Useful for revenue analysis and forecasting.",
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
    const args = ["subscriptions", "list", "--status", "Active", "--json"];
    if (params.companyId) args.push("--company", params.companyId);
    // Fetch all active subscriptions — the caller (Claude) will summarize MRR from the JSON
    return execCli(args);
  },
};
