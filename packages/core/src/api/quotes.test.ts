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
  createdOn: "2026-01-15",
  expiresOn: "2026-02-15",
  status: "Draft",
  lineItems: [],
};

const samplePaginatedResponse = {
  page: { size: 50, totalElements: 1, totalPages: 1, number: 0 },
  content: [sampleQuote],
};

// Per #307: every QuotesApi call must thread `{ apiVersion: "v2" }` through to
// the client so the resolved wire URL hits `/v2/quotes/...` instead of the base
// URL's default `/v1`. Assertions below pin this — a regression here means a
// quote operation is back on /v1 and will 404 against the real API.
const V2_OPTS = { apiVersion: "v2" };

describe("QuotesApi", () => {
  let client: Pax8Client;
  let api: QuotesApi;

  beforeEach(() => {
    client = createMockClient();
    api = new QuotesApi(client);
  });

  it("list returns paginated quotes (routed to /v2)", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedResponse);

    const result = await api.list({ page: 0, size: 50, companyId: COMPANY_ID });

    expect(client.get).toHaveBeenCalledWith(
      "/quotes",
      { page: 0, size: 50, companyId: COMPANY_ID },
      V2_OPTS,
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0].status).toBe("Draft");
  });

  it("get returns a single quote (routed to /v2)", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);

    const result = await api.get(QUOTE_ID);

    expect(client.get).toHaveBeenCalledWith(`/quotes/${QUOTE_ID}`, undefined, V2_OPTS);
    expect(result.companyId).toBe(COMPANY_ID);
  });

  // Per #311: `POST /v2/quotes` accepts only `{ clientId, quoteRequestId? }`.
  // Line items are added through a separate `POST /v2/quotes/{id}/line-items`
  // call. A regression to the pre-#311 `{ companyId, lineItems }` shape
  // would 4xx against the real API.
  it("create sends { clientId } only (routed to /v2)", async () => {
    const input = { clientId: COMPANY_ID };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);

    const result = await api.create(input);

    expect(client.post).toHaveBeenCalledWith("/quotes", input, V2_OPTS);
    expect(result.id).toBe(QUOTE_ID);
  });

  it("create forwards an optional quoteRequestId when provided (routed to /v2)", async () => {
    const input = {
      clientId: COMPANY_ID,
      quoteRequestId: "qr-1111-2222-3333-4444-555555555555",
    };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);

    await api.create(input);

    expect(client.post).toHaveBeenCalledWith("/quotes", input, V2_OPTS);
  });

  it("update sends correct body (routed to /v2)", async () => {
    const input = { expiresOn: "2026-03-15" };
    const updated = { ...sampleQuote, expiresOn: "2026-03-15" };
    (client.put as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.update(QUOTE_ID, input);

    expect(client.put).toHaveBeenCalledWith(`/quotes/${QUOTE_ID}`, input, V2_OPTS);
    expect(result.expiresOn).toBe("2026-03-15");
  });

  it("delete calls client.delete (routed to /v2)", async () => {
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await api.delete(QUOTE_ID);

    expect(client.delete).toHaveBeenCalledWith(`/quotes/${QUOTE_ID}`, undefined, V2_OPTS);
  });

  it("addLineItem POSTs an array with a Standard payload then re-fetches the quote (routed to /v2)", async () => {
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);
    const productId = "d4e5f6a7-b890-1234-cdef-567890123456";

    const result = await api.addLineItem(QUOTE_ID, {
      productId,
      quantity: 4,
      billingTerm: "Annual",
    });

    expect(client.post).toHaveBeenCalledWith(
      `/quotes/${QUOTE_ID}/line-items`,
      [
        {
          type: "Standard",
          productId,
          quantity: 4,
          billingTerm: "Annual",
        },
      ],
      V2_OPTS,
    );
    expect(client.get).toHaveBeenCalledWith(`/quotes/${QUOTE_ID}`, undefined, V2_OPTS);
    expect(result.id).toBe(QUOTE_ID);
  });

  it("removeLineItem DELETEs the nested line-item path (routed to /v2)", async () => {
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const lineItemId = "11111111-2222-3333-4444-555555555555";

    await api.removeLineItem(QUOTE_ID, lineItemId);

    expect(client.delete).toHaveBeenCalledWith(
      `/quotes/${QUOTE_ID}/line-items/${lineItemId}`,
      undefined,
      V2_OPTS,
    );
  });

  it("setStatus PUTs { status } to the quote endpoint (routed to /v2)", async () => {
    (client.put as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...sampleQuote,
      status: "sent",
    });

    const result = await api.setStatus(QUOTE_ID, "sent");

    expect(client.put).toHaveBeenCalledWith(
      `/quotes/${QUOTE_ID}`,
      { status: "sent" },
      V2_OPTS,
    );
    expect(result.status).toBe("sent");
  });

  it("send is a thin wrapper over setStatus(id, 'sent') (routed to /v2)", async () => {
    (client.put as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...sampleQuote,
      status: "sent",
    });

    await api.send(QUOTE_ID);

    expect(client.put).toHaveBeenCalledWith(
      `/quotes/${QUOTE_ID}`,
      { status: "sent" },
      V2_OPTS,
    );
  });
});
