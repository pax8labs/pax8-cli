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

    // `lineItemNumber` is auto-injected on every outgoing line — required by
    // the spec's `CreateLineItem` schema even though the CLI doesn't expose
    // it as user-facing input (#331).
    expect(client.post).toHaveBeenCalledWith("/orders", {
      companyId: COMPANY_ID,
      lineItems: [
        { productId: "d4e5f6a7-b890-1234-cdef-567890123456", quantity: 5, lineItemNumber: 1 },
      ],
    });
    expect(result.id).toBe(ORDER_ID);
  });

  it("create auto-injects 1-based lineItemNumber on every line (#331)", async () => {
    const input = {
      companyId: COMPANY_ID,
      lineItems: [
        { productId: "d4e5f6a7-b890-1234-cdef-567890123456", quantity: 5 },
        { productId: "e5f6a7b8-9012-3456-cdef-789012345678", quantity: 10 },
        { productId: "f6a7b890-1234-5678-cdef-90123456789a", quantity: 3 },
      ],
    };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(sampleOrder);

    await api.create(input);

    const sentPayload = (client.post as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      lineItems: Array<{ lineItemNumber: number }>;
    };
    expect(sentPayload.lineItems.map((li) => li.lineItemNumber)).toEqual([1, 2, 3]);
  });

  it("create preserves caller-supplied lineItemNumber when provided (#331)", async () => {
    const input = {
      companyId: COMPANY_ID,
      lineItems: [
        // Caller-supplied — `OrdersApi.create()` must not overwrite, since
        // future parent/child line-item flows might want non-sequential
        // numbering.
        { productId: "d4e5f6a7-b890-1234-cdef-567890123456", quantity: 5, lineItemNumber: 100 },
        // No `lineItemNumber` → fills with idx + 1 (i.e. 2, not 101).
        { productId: "e5f6a7b8-9012-3456-cdef-789012345678", quantity: 10 },
      ],
    };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(sampleOrder);

    await api.create(input);

    const sentPayload = (client.post as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      lineItems: Array<{ lineItemNumber: number }>;
    };
    expect(sentPayload.lineItems.map((li) => li.lineItemNumber)).toEqual([100, 2]);
  });

  it("create forwards spec-shaped provisioningDetails on the wire (#332)", async () => {
    // The public Pax8 OpenAPI's `CreateLineItem.provisioningDetails` is an
    // array of `{ key, values: string[] }` objects (not a free-form record).
    // This test pins the wire shape: whatever the caller hands to
    // `OrdersApi.create()` must reach `client.post` unchanged.
    const input = {
      companyId: COMPANY_ID,
      lineItems: [
        {
          productId: "d4e5f6a7-b890-1234-cdef-567890123456",
          quantity: 5,
          provisioningDetails: [
            { key: "domain", values: ["contoso.com"] },
            { key: "region", values: ["us-east", "us-west"] },
          ],
        },
      ],
    };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(sampleOrder);

    await api.create(input);

    const sentPayload = (client.post as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      lineItems: Array<{ provisioningDetails?: Array<{ key: string; values: string[] }> }>;
    };
    expect(sentPayload.lineItems[0].provisioningDetails).toEqual([
      { key: "domain", values: ["contoso.com"] },
      { key: "region", values: ["us-east", "us-west"] },
    ]);
  });

  it("create wires isMock=true to the dry-run query string", async () => {
    const input = {
      companyId: COMPANY_ID,
      lineItems: [
        { productId: "d4e5f6a7-b890-1234-cdef-567890123456", quantity: 5 },
      ],
    };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(sampleOrder);

    await api.create(input, { isMock: true });

    expect((client.post as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "/orders?isMock=true",
    );
  });

  it("throws on invalid data from API", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ invalid: true });

    await expect(api.get(ORDER_ID)).rejects.toThrow();
  });
});
