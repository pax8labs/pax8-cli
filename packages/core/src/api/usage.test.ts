// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { UsageApi } from "./usage.js";
import type { Pax8Client } from "./client.js";

function createMockClient(): Pax8Client {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getPaginated: vi.fn(),
  } as unknown as Pax8Client;
}

const SUMMARY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const COMPANY_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const PRODUCT_ID = "c3d4e5f6-a7b8-9012-cdef-123456789012";
const SUBSCRIPTION_ID = "e5f6a7b8-9012-3456-cdef-7890abcdef12";

// Wire shapes captured from the live API (2026-11-05); values synthetic.
const sampleSummary = {
  id: SUMMARY_ID,
  companyId: COMPANY_ID,
  subscriptionId: SUBSCRIPTION_ID,
  productId: PRODUCT_ID,
  resourceGroup: "Compute",
  vendorName: "Microsoft",
  currencyCode: "USD",
  currentCharges: 50,
  partnerTotal: 40,
  isTrial: false,
};

const sampleLine = {
  usageDate: "2026-03-01",
  productId: PRODUCT_ID,
  productName: "Virtual Machines",
  unitOfMeasure: "Hour",
  quantity: 50,
  unitPrice: 0.5,
  currentCharges: 25,
  currentProfit: 5,
  partnerTotal: 20,
  currencyCode: "USD",
  isTrial: false,
};

const samplePaginatedSummaries = {
  page: { size: 50, totalElements: 1, totalPages: 1, number: 0 },
  content: [sampleSummary],
};

const samplePaginatedLines = {
  page: { size: 50, totalElements: 1, totalPages: 1, number: 0 },
  content: [sampleLine],
};

describe("UsageApi", () => {
  let client: Pax8Client;
  let api: UsageApi;

  beforeEach(() => {
    client = createMockClient();
    api = new UsageApi(client);
  });

  it("listSummaries hits the nested subscription path documented by the spec", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedSummaries);

    const result = await api.listSummaries(SUBSCRIPTION_ID, { page: 0, size: 50 });

    // Regression guard for #337: the flat `/usage-summaries` list endpoint
    // does NOT exist in the Pax8 public spec — usage summaries are only
    // exposed under `/subscriptions/{subscriptionId}/usage-summaries`.
    expect(client.get).toHaveBeenCalledWith(
      `/subscriptions/${SUBSCRIPTION_ID}/usage-summaries`,
      { page: 0, size: 50, sort: "resourceGroup,asc" },
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0].currentCharges).toBe(50);
  });

  it("listSummaries sends an explicit sort even without params", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedSummaries);

    await api.listSummaries(SUBSCRIPTION_ID);

    expect(client.get).toHaveBeenCalledWith(
      `/subscriptions/${SUBSCRIPTION_ID}/usage-summaries`,
      { sort: "resourceGroup,asc" },
    );
  });

  it("listSummaries preserves pagination and resource group filters with the sort", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedSummaries);

    await api.listSummaries(SUBSCRIPTION_ID, { page: 2, size: 10, resourceGroup: "Compute" });

    expect(client.get).toHaveBeenCalledWith(
      `/subscriptions/${SUBSCRIPTION_ID}/usage-summaries`,
      { page: 2, size: 10, resourceGroup: "Compute", sort: "resourceGroup,asc" },
    );
  });

  it("getSummary returns a single usage summary", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleSummary);

    const result = await api.getSummary(SUMMARY_ID);

    expect(client.get).toHaveBeenCalledWith(`/usage-summaries/${SUMMARY_ID}`);
    expect(result.partnerTotal).toBe(40);
  });

  it("listLines hits the /usage-lines leaf (not /lines)", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedLines);

    const result = await api.listLines(SUMMARY_ID, { usageDate: "2026-03-01", page: 0, size: 50 });

    // Regression guard for #337: the leaf segment is `usage-lines`, not
    // `lines`. One-character drift on the leaf path caused 404s in #212.
    expect(client.get).toHaveBeenCalledWith(
      `/usage-summaries/${SUMMARY_ID}/usage-lines`,
      { usageDate: "2026-03-01", page: 0, size: 50 },
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0].usageDate).toBe("2026-03-01");
  });

  it("listSummaries returns an empty page when the API omits content", async () => {
    // Live behavior for a subscription with no usage: `{ page }` only. Before
    // this was handled, every such call failed with ERROR_API_VALIDATION.
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      page: { size: 10, totalElements: 0, totalPages: 0, number: 0 },
    });

    const result = await api.listSummaries(SUBSCRIPTION_ID);

    expect(result.content).toEqual([]);
  });
});
