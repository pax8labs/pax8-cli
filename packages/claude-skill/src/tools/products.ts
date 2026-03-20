import { execCli } from "../index.js";

export const pax8_products_search = {
  name: "pax8_products_search",
  description:
    "Search the Pax8 product catalog by keyword. Returns product name, vendor, SKU, and pricing information.",
  parameters: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Search query (product name, vendor, or keyword).",
      },
      vendorId: {
        type: "string",
        description: "Filter by vendor ID (UUID). Optional.",
      },
      page: { type: "number", description: "Page number (0-based). Optional." },
      size: {
        type: "number",
        description: "Page size. Optional, default 50.",
      },
    },
    required: ["query"],
  },
  execute: async (params: {
    query: string;
    vendorId?: string;
    page?: number;
    size?: number;
  }) => {
    const args = ["products", "search", params.query, "--json"];
    if (params.vendorId) args.push("--vendor", params.vendorId);
    if (params.page !== undefined) args.push("--page", String(params.page));
    if (params.size !== undefined) args.push("--size", String(params.size));
    return execCli(args);
  },
};
