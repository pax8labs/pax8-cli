// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { execCli } from "../index.js";

export const pax8_recommendations = {
  name: "pax8_recommendations",
  description:
    "Analyze customer portfolios and recommend products they should consider. Returns a wrapped envelope `{ recommendations: [...], totalAvailable: number }` — each recommendation carries type (cross-sell or seat-gap), companyName, productName, priority (high/medium/low), reason, estimatedMRR, and orderCommand. Sorted by estimatedMrrUplift DESC, priority as tiebreaker, nulls last. Capped at 10 by default; pass `top: 0` to retrieve all (compare against `totalAvailable` to know if the cap fired). Filter by companyId (name or UUID) and/or priority level. Use this for upsell opportunities, product gaps, or revenue growth questions.",
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
      top: {
        type: "number",
        description:
          "Cap the number of recommendations returned (default 10). Pass 0 for unlimited. Compare the returned array length against `totalAvailable` to know whether the cap hid additional opportunities.",
      },
    },
  },
  execute: async (params: { companyId?: string; priority?: string; top?: number }) => {
    const args = ["recommendations", "list", "--json"];
    if (params.companyId) args.push("--company", params.companyId);
    if (params.priority) args.push("--priority", params.priority);
    if (typeof params.top === "number") args.push("--top", String(params.top));
    return execCli(args);
  },
};
