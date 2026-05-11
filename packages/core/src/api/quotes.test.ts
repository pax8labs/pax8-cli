// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { QuotesApi, buildFullUpdatePayload } from "./quotes.js";
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
  status: "draft",
  introMessage: "Hello partner.",
  termsAndDisclaimers: "Standard 30-day terms.",
  published: false,
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
    expect(result.content[0].status).toBe("draft");
  });

  it("get returns a single quote (routed to /v2)", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);

    const result = await api.get(QUOTE_ID);

    expect(client.get).toHaveBeenCalledWith(`/quotes/${QUOTE_ID}`, undefined, V2_OPTS);
    expect(result.companyId).toBe(COMPANY_ID);
  });

  it("create sends correct body (routed to /v2)", async () => {
    const input = { clientId: COMPANY_ID };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);

    const result = await api.create(input);

    expect(client.post).toHaveBeenCalledWith("/quotes", input, V2_OPTS);
    expect(result.id).toBe(QUOTE_ID);
  });

  // ─── #313 / #314: fetch-then-merge body shape ──────────────────────────────
  //
  // `PUT /v2/quotes/{id}` requires all five mutable fields on every call. The
  // CLI exposes a partial-override interface; the API client fetches the
  // current quote and projects (current + overrides) into the full body
  // before PUTing. The next tests pin that contract end-to-end.

  describe("update (fetch-then-merge)", () => {
    it("PUTs all 5 required fields when only --expiration-date is overridden", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...sampleQuote,
        expiresOn: "2026-03-15T00:00:00Z",
      });

      const result = await api.update(QUOTE_ID, {
        expiresOn: "2026-03-15T00:00:00Z",
      });

      // Pre-flight GET so we know what to merge.
      expect(client.get).toHaveBeenCalledWith(`/quotes/${QUOTE_ID}`, undefined, V2_OPTS);
      // Full 5-field PUT — date is the override, other 4 are merged from
      // the current quote.
      expect(client.put).toHaveBeenCalledWith(
        `/quotes/${QUOTE_ID}`,
        {
          expiresOn: "2026-03-15T00:00:00Z",
          introMessage: "Hello partner.",
          published: false,
          status: "draft",
          termsAndDisclaimers: "Standard 30-day terms.",
        },
        V2_OPTS,
      );
      expect(result.expiresOn).toBe("2026-03-15T00:00:00Z");
    });

    it("merges current values when no overrides are supplied", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);

      await api.update(QUOTE_ID, {});

      expect(client.put).toHaveBeenCalledWith(
        `/quotes/${QUOTE_ID}`,
        {
          expiresOn: "2026-02-15",
          introMessage: "Hello partner.",
          published: false,
          status: "draft",
          termsAndDisclaimers: "Standard 30-day terms.",
        },
        V2_OPTS,
      );
    });
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
      effectiveDate: "2026-06-01T00:00:00Z",
      price: 36.0,
    });

    expect(client.post).toHaveBeenCalledWith(
      `/quotes/${QUOTE_ID}/line-items`,
      [
        {
          type: "Standard",
          productId,
          quantity: 4,
          billingTerm: "Annual",
          effectiveDate: "2026-06-01T00:00:00Z",
          price: 36.0,
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

  describe("setStatus (fetch-then-merge)", () => {
    // #314: status transitions ride the same `PUT /v2/quotes/{id}` as `update`.
    // The v2 spec has no separate status-only endpoint — every status flip
    // must send the full 5-field body.
    it("PUTs all 5 required fields with status overridden", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...sampleQuote,
        status: "sent",
      });

      const result = await api.setStatus(QUOTE_ID, "sent");

      expect(client.get).toHaveBeenCalledWith(`/quotes/${QUOTE_ID}`, undefined, V2_OPTS);
      expect(client.put).toHaveBeenCalledWith(
        `/quotes/${QUOTE_ID}`,
        {
          expiresOn: "2026-02-15",
          introMessage: "Hello partner.",
          published: false,
          status: "sent",
          termsAndDisclaimers: "Standard 30-day terms.",
        },
        V2_OPTS,
      );
      expect(result.status).toBe("sent");
    });
  });

  it("send is a thin wrapper over setStatus(id, 'sent') (full PUT body via fetch-then-merge)", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleQuote);
    (client.put as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...sampleQuote,
      status: "sent",
    });

    await api.send(QUOTE_ID);

    expect(client.put).toHaveBeenCalledWith(
      `/quotes/${QUOTE_ID}`,
      {
        expiresOn: "2026-02-15",
        introMessage: "Hello partner.",
        published: false,
        status: "sent",
        termsAndDisclaimers: "Standard 30-day terms.",
      },
      V2_OPTS,
    );
  });
});

describe("buildFullUpdatePayload", () => {
  // Standalone unit tests for the shared helper. `update` and `setStatus`
  // both ride this projection — pinning it here keeps each call site short
  // and makes the merge precedence explicit.
  const current = {
    id: QUOTE_ID,
    companyId: COMPANY_ID,
    createdOn: "2026-01-15",
    expiresOn: "2026-02-15",
    status: "draft",
    introMessage: "Hello partner.",
    termsAndDisclaimers: "Standard terms.",
    published: false,
    lineItems: [],
  };

  it("overrides win, current fills the rest", () => {
    const body = buildFullUpdatePayload(current, {
      expiresOn: "2026-03-15T00:00:00Z",
      status: "sent",
    });
    expect(body).toEqual({
      expiresOn: "2026-03-15T00:00:00Z",
      introMessage: "Hello partner.",
      published: false,
      status: "sent",
      termsAndDisclaimers: "Standard terms.",
    });
  });

  it("defaults published to false when neither current nor override has it", () => {
    const { published: _p, ...withoutPublished } = current;
    void _p;
    const body = buildFullUpdatePayload(withoutPublished, {});
    expect(body.published).toBe(false);
  });

  it("lowercases the current status to match the v2 enum", () => {
    const body = buildFullUpdatePayload({ ...current, status: "Draft" }, {});
    expect(body.status).toBe("draft");
  });

  it("uses override expiresOn when current is missing it", () => {
    const { expiresOn: _e, ...withoutExp } = current;
    void _e;
    const body = buildFullUpdatePayload(withoutExp, {
      expiresOn: "2026-04-01T00:00:00Z",
    });
    expect(body.expiresOn).toBe("2026-04-01T00:00:00Z");
  });
});
