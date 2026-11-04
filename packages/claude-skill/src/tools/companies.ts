// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { execCli } from "../index.js";

export const pax8_companies_list = {
  name: "pax8_companies_list",
  description:
    "List all companies managed through Pax8. Returns id, name, status, city, and stateOrProvince for each company. Supports pagination with page/size. Use the company id from results to filter subscriptions, invoices, and recommendations.",
  parameters: {
    type: "object" as const,
    properties: {
      page: { type: "number", description: "Page number (0-based). Optional." },
      size: {
        type: "number",
        description: "Page size. Optional, default 50.",
      },
    },
  },
  execute: async (params: { page?: number; size?: number }) => {
    const args = ["clients", "list", "--json"];
    if (params.page !== undefined) args.push("--page", String(params.page));
    if (params.size !== undefined) args.push("--size", String(params.size));
    return execCli(args);
  },
};

export const pax8_companies_show = {
  name: "pax8_companies_show",
  description:
    "Show details for a specific company including name, address, status, website, phone, and external ID. Pass --subscriptions to also return the company's active subscriptions inline. Accepts a company UUID or exact name.",
  parameters: {
    type: "object" as const,
    properties: {
      id: { type: "string", description: "Company ID (UUID) or name." },
      subscriptions: {
        type: "boolean",
        description: "Include active subscriptions. Default: false.",
      },
    },
    required: ["id"],
  },
  execute: async (params: { id: string; subscriptions?: boolean }) => {
    const args = ["clients", "show", params.id, "--json"];
    if (params.subscriptions) args.push("--subscriptions");
    return execCli(args);
  },
};
