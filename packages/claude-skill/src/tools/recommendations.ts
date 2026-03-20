import { execCli } from "../index.js";

export const pax8_recommendations = {
  name: "pax8_recommendations",
  description:
    "Analyze customer portfolios and recommend products they should consider. Returns cross-sell opportunities (missing product categories like backup, security, identity) and seat gaps (partial coverage). Each recommendation includes the exact CLI command to place the order. Use this when users ask about upsell opportunities, what products customers need, or how to grow revenue.",
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
