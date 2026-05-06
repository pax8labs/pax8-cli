// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrdersApi } from "./orders.js";
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

const ORDER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const COMPANY_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

const sampleOrder = {
  id: ORDER_ID,
  companyId: COMPANY_ID,
  orderedBy: "Admin",
  createdDate: "2026-01-15",
  lineItems: [
    {
      id: "c3d4e5f6-a7b8-9012-cdef-123456789012",
      productId: "d4e5f6a7-b890-1234-cdef-567890123456",
      quantity: 10,
    },
  ],
};

const samplePaginatedResponse = {
  page: { size: 50, totalElements: 1, totalPages: 1, number: 0 },
  content: [sampleOrder],
};

describe("OrdersApi", () => {
  let client: Pax8Client;
  let api: OrdersApi;

  beforeEach(() => {
    client = createMockClient();
    api = new OrdersApi(client);
  });

  it("list returns paginated orders", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedResponse);

    const result = await api.list({ page: 0, size: 50, companyId: COMPANY_ID });

    expect(client.get).toHaveBeenCalledWith("/orders", { page: 0, size: 50, companyId: COMPANY_ID });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].id).toBe(ORDER_ID);
  });

  it("get returns a single order", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleOrder);

    const result = await api.get(ORDER_ID);

    expect(client.get).toHaveBeenCalledWith(`/orders/${ORDER_ID}`);
    expect(result.companyId).toBe(COMPANY_ID);
  });

  it("create sends correct body and returns order", async () => {
    const input = {
      companyId: COMPANY_ID,
      lineItems: [
        { productId: "d4e5f6a7-b890-1234-cdef-567890123456", quantity: 5 },
      ],
    };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(sampleOrder);

    const result = await api.create(input);

    expect(client.post).toHaveBeenCalledWith("/orders", input);
    expect(result.id).toBe(ORDER_ID);
  });

  it("throws on invalid data from API", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ invalid: true });

    await expect(api.get(ORDER_ID)).rejects.toThrow();
  });
});
