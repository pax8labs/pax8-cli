// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { QuotesApi } from "./quotes.js";
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

const QUOTE_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const COMPANY_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

const sampleQuote = {
  id: QUOTE_ID,
  companyId: COMPANY_ID,
  createdDate: "2026-01-15",
  expirationDate: "2026-02-15",
  status: "Draft",
  lineItems: [],
};

const samplePaginatedResponse = {
  page: { size: 50, totalElements: 1, totalPages: 1, number: 0 },
  content: [sampleQuote],
};

describe("QuotesApi", () => {
  let client: Pax8Client;
  let api: QuotesApi;

  beforeEach(() => {
    client = createMockClient();
    api = new QuotesApi(client);
  });

  it("list returns paginated quotes", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedResponse);

    const result = await api.list({ page: 0, size: 50, companyId: COMPANY_ID });

    expect(client.get).toHaveBeenCalledWith("/quotes", { page: 0, size: 50, companyId: COMPANY_ID });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].status).toBe("Draft");
  });

  it("get returns a single quote", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);

    const result = await api.get(QUOTE_ID);

    expect(client.get).toHaveBeenCalledWith(`/quotes/${QUOTE_ID}`);
    expect(result.companyId).toBe(COMPANY_ID);
  });

  it("create sends correct body", async () => {
    const input = {
      companyId: COMPANY_ID,
      lineItems: [
        { productId: "d4e5f6a7-b890-1234-cdef-567890123456", quantity: 10 },
      ],
    };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);

    const result = await api.create(input);

    expect(client.post).toHaveBeenCalledWith("/quotes", input);
    expect(result.id).toBe(QUOTE_ID);
  });

  it("update sends correct body", async () => {
    const input = { expirationDate: "2026-03-15" };
    const updated = { ...sampleQuote, expirationDate: "2026-03-15" };
    (client.put as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.update(QUOTE_ID, input);

    expect(client.put).toHaveBeenCalledWith(`/quotes/${QUOTE_ID}`, input);
    expect(result.expirationDate).toBe("2026-03-15");
  });

  it("delete calls client.delete", async () => {
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await api.delete(QUOTE_ID);

    expect(client.delete).toHaveBeenCalledWith(`/quotes/${QUOTE_ID}`);
  });
});
