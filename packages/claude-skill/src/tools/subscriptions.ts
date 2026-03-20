import { execCli } from "../index.js";

export const pax8_subscriptions_list = {
  name: "pax8_subscriptions_list",
  description:
    "List subscriptions across all companies or filtered to a specific company. Returns subscription ID, product, company, quantity, status, and billing term.",
  parameters: {
    type: "object" as const,
    properties: {
      companyId: {
        type: "string",
        description: "Filter by company ID (UUID). Optional.",
      },
      status: {
        type: "string",
        description:
          "Filter by status (Active, Cancelled, PendingManual, etc.). Optional.",
      },
      page: { type: "number", description: "Page number (0-based). Optional." },
      size: {
        type: "number",
        description: "Page size. Optional, default 50.",
      },
    },
  },
  execute: async (params: {
    companyId?: string;
    status?: string;
    page?: number;
    size?: number;
  }) => {
    const args = ["subscriptions", "list", "--json"];
    if (params.companyId) args.push("--company", params.companyId);
    if (params.status) args.push("--status", params.status);
    if (params.page !== undefined) args.push("--page", String(params.page));
    if (params.size !== undefined) args.push("--size", String(params.size));
    return execCli(args);
  },
};

export const pax8_subscriptions_renewals = {
  name: "pax8_subscriptions_renewals",
  description:
    "List subscriptions with upcoming renewals. Shows subscription details with renewal dates, sorted by soonest renewal first.",
  parameters: {
    type: "object" as const,
    properties: {
      within: {
        type: "number",
        description:
          "Number of days to look ahead for renewals. Default: 30.",
      },
      companyId: {
        type: "string",
        description: "Filter by company ID (UUID). Optional.",
      },
    },
  },
  execute: async (params: { within?: number; companyId?: string }) => {
    const args = ["subscriptions", "renewals", "--json"];
    if (params.within !== undefined)
      args.push("--within", String(params.within));
    if (params.companyId) args.push("--company", params.companyId);
    return execCli(args);
  },
};
