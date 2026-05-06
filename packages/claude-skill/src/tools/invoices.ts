// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { execCli } from "../index.js";

export const pax8_invoices_list = {
  name: "pax8_invoices_list",
  description:
    "List invoices with total, balance, status, dueDate, and invoiceDate. Filter by month (YYYY-MM, defaults to current month) and/or companyId. Supports pagination. Returns companyName resolved for each invoice.",
  parameters: {
    type: "object" as const,
    properties: {
      month: {
        type: "string",
        description:
          "Filter by month in YYYY-MM format. Defaults to current month. Optional.",
      },
      companyId: {
        type: "string",
        description: "Filter by company ID (UUID). Optional.",
      },
      page: { type: "number", description: "Page number (0-based). Optional." },
      size: {
        type: "number",
        description: "Page size. Optional, default 50.",
      },
    },
  },
  execute: async (params: {
    month?: string;
    companyId?: string;
    page?: number;
    size?: number;
  }) => {
    const args = ["invoices", "list", "--json"];
    if (params.month) args.push("--month", params.month);
    if (params.companyId) args.push("--company", params.companyId);
    if (params.page !== undefined) args.push("--page", String(params.page));
    if (params.size !== undefined) args.push("--size", String(params.size));
    return execCli(args);
  },
};

export const pax8_invoices_audit = {
  name: "pax8_invoices_audit",
  description:
    "Audit invoices for discrepancies — highlights billing anomalies, quantity mismatches, and unusual charges. Returns findings with severity, description, affectedCompany, and estimatedImpact. Filter by month (YYYY-MM, defaults to current month).",
  parameters: {
    type: "object" as const,
    properties: {
      month: {
        type: "string",
        description:
          "Month to audit in YYYY-MM format. Defaults to current month. Optional.",
      },
    },
  },
  execute: async (params: { month?: string }) => {
    const args = ["invoices", "audit", "--json"];
    if (params.month) args.push("--month", params.month);
    return execCli(args);
  },
};
