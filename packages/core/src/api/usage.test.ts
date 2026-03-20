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

const sampleSummary = {
  id: SUMMARY_ID,
  companyId: COMPANY_ID,
  productId: PRODUCT_ID,
  date: "2026-03-01",
  quantity: 100,
  unitPrice: 0.5,
  subtotal: 50,
  resourceGroup: "Compute",
};

const sampleLine = {
  id: "d4e5f6a7-b890-1234-cdef-567890123456",
  usageSummaryId: SUMMARY_ID,
  quantity: 50,
  unitPrice: 0.5,
  subtotal: 25,
  description: "VM hours",
  date: "2026-03-01",
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

  it("listSummaries returns paginated usage summaries", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedSummaries);

    const result = await api.listSummaries({ page: 0, size: 50, companyId: COMPANY_ID });

    expect(client.get).toHaveBeenCalledWith("/usage-summaries", { page: 0, size: 50, companyId: COMPANY_ID });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].subtotal).toBe(50);
  });

  it("getSummary returns a single usage summary", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleSummary);

    const result = await api.getSummary(SUMMARY_ID);

    expect(client.get).toHaveBeenCalledWith(`/usage-summaries/${SUMMARY_ID}`);
    expect(result.quantity).toBe(100);
  });

  it("listLines returns paginated usage lines", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedLines);

    const result = await api.listLines(SUMMARY_ID, { page: 0, size: 50 });

    expect(client.get).toHaveBeenCalledWith(`/usage-summaries/${SUMMARY_ID}/lines`, { page: 0, size: 50 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].description).toBe("VM hours");
  });
});
