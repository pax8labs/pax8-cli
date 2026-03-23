import { execCli } from "../index.js";

export const pax8_recommendations = {
  name: "pax8_recommendations",
  description:
    "Analyze customer portfolios and recommend products they should consider. Returns type (cross-sell or seat-gap), companyName, productName, priority (high/medium/low), reason, estimatedMRR, and orderCommand for each recommendation. Filter by companyId (name or UUID) and/or priority level. Use this for upsell opportunities, product gaps, or revenue growth questions.",
  parameters: {
    type: "object" as const,
    properties: {
      companyId: {
        type: "string",
        description:
          "Filter to a specific company ID or name. Optional — omit for all companies.",
      },
      priority: {
        type: "string",
        description:
          "Filter by priority: high, medium, or low. Optional — omit for all priorities.",
      },
    },
  },
  execute: async (params: { companyId?: string; priority?: string }) => {
    const args = ["recommendations", "list", "--json"];
    if (params.companyId) args.push("--company", params.companyId);
    if (params.priority) args.push("--priority", params.priority);
    return execCli(args);
  },
};
