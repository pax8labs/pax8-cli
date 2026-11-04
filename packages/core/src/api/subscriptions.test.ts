// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubscriptionsApi, normalizeCancelDateForWire } from "./subscriptions.js";
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

const SUB_ID = "d4e5f6a7-b8c9-0123-defa-456789012345";
const COMPANY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PRODUCT_ID = "f6a7b8c9-0123-4567-89ab-cdef01234567";

const sampleSubscription = {
  id: SUB_ID,
  companyId: COMPANY_ID,
  productId: PRODUCT_ID,
  quantity: 45,
  startDate: "2025-01-01",
  createdDate: "2025-01-01",
  status: "Active",
  price: 22.50,
  billingTerm: "Annual",
  commitmentTermEndDate: "2026-01-01",
};

const samplePaginatedResponse = {
  page: { size: 50, totalElements: 1, totalPages: 1, number: 0 },
  content: [sampleSubscription],
};

describe("SubscriptionsApi", () => {
  let client: Pax8Client;
  let api: SubscriptionsApi;

  beforeEach(() => {
    client = createMockClient();
    api = new SubscriptionsApi(client);
  });

  it("list returns paginated subscriptions", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedResponse);

    const result = await api.list({ companyId: COMPANY_ID });

    expect(client.get).toHaveBeenCalledWith("/subscriptions", { companyId: COMPANY_ID });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].quantity).toBe(45);
  });

  describe("streamAll (#613)", () => {
    function makePage(opts: {
      number: number;
      totalPages: number;
      totalElements: number;
      contentSize: number;
    }) {
      const content = Array.from({ length: opts.contentSize }, (_, i) => ({
        ...sampleSubscription,
        // Distinct IDs per row so the test can assert ordering / count.
        id: `${SUB_ID.slice(0, -4)}${(opts.number * 1000 + i).toString().padStart(4, "0")}`,
      }));
      return {
        page: {
          size: 1000,
          totalElements: opts.totalElements,
          totalPages: opts.totalPages,
          number: opts.number,
        },
        content,
      };
    }

    it("walks every page until totalPages is reached", async () => {
      // 3-page portfolio: pages 0, 1, 2 with 1000+1000+250 = 2250 subs.
      const page0 = makePage({ number: 0, totalPages: 3, totalElements: 2250, contentSize: 1000 });
      const page1 = makePage({ number: 1, totalPages: 3, totalElements: 2250, contentSize: 1000 });
      const page2 = makePage({ number: 2, totalPages: 3, totalElements: 2250, contentSize: 250 });
      const getMock = client.get as ReturnType<typeof vi.fn>;
      getMock
        .mockResolvedValueOnce(page0)
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2);

      const pages = [];
      for await (const p of api.streamAll()) {
        pages.push(p);
      }

      expect(pages).toHaveLength(3);
      expect(pages.flatMap((p) => p.content)).toHaveLength(2250);
      // Page 0 must be fetched first, then 1, then 2 — verifies the
      // sequential page-walker hasn't been mis-wired to e.g. always fetch
      // page 0.
      expect(getMock).toHaveBeenNthCalledWith(1, "/subscriptions", { page: 0, size: 1000 });
      expect(getMock).toHaveBeenNthCalledWith(2, "/subscriptions", { page: 1, size: 1000 });
      expect(getMock).toHaveBeenNthCalledWith(3, "/subscriptions", { page: 2, size: 1000 });
    });

    it("stops after a single request when totalPages is 1", async () => {
      const onePage = makePage({ number: 0, totalPages: 1, totalElements: 42, contentSize: 42 });
      const getMock = client.get as ReturnType<typeof vi.fn>;
      getMock.mockResolvedValueOnce(onePage);

      const pages = [];
      for await (const p of api.streamAll()) {
        pages.push(p);
      }

      expect(pages).toHaveLength(1);
      expect(getMock).toHaveBeenCalledTimes(1);
    });

    it("yields zero pages when totalPages is 0 (empty portfolio)", async () => {
      const empty = {
        page: { size: 1000, totalElements: 0, totalPages: 0, number: 0 },
        content: [],
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(empty);

      const pages = [];
      for await (const p of api.streamAll()) {
        pages.push(p);
      }

      // totalPages=0 means the while-loop exits after page 0 fires once.
      // The empty page still gets yielded so callers see a definite
      // "yes I checked, the answer is zero" rather than no yield at all.
      expect(pages).toHaveLength(1);
      expect(pages[0].content).toEqual([]);
    });

    it("propagates filter params verbatim on every page", async () => {
      const page0 = makePage({ number: 0, totalPages: 2, totalElements: 1100, contentSize: 1000 });
      const page1 = makePage({ number: 1, totalPages: 2, totalElements: 1100, contentSize: 100 });
      const getMock = client.get as ReturnType<typeof vi.fn>;
      getMock.mockResolvedValueOnce(page0).mockResolvedValueOnce(page1);

      const pages = [];
      for await (const p of api.streamAll({ status: "Active", companyId: COMPANY_ID })) {
        pages.push(p);
      }

      // Both page calls carry the filter — agents pushing a server-side
      // filter to reduce wire bytes depend on this.
      expect(getMock).toHaveBeenNthCalledWith(1, "/subscriptions", {
        status: "Active",
        companyId: COMPANY_ID,
        page: 0,
        size: 1000,
      });
      expect(getMock).toHaveBeenNthCalledWith(2, "/subscriptions", {
        status: "Active",
        companyId: COMPANY_ID,
        page: 1,
        size: 1000,
      });
    });
  });

  it("get returns a single subscription", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleSubscription);

    const result = await api.get(SUB_ID);

    expect(client.get).toHaveBeenCalledWith(`/subscriptions/${SUB_ID}`);
    expect(result.status).toBe("Active");
  });

  it("getHistory returns subscription history", async () => {
    const history = [
      {
        id: "e5f6a7b8-c9d0-1234-5678-9abcdef01234",
        action: "QuantityChanged",
        date: "2025-06-15",
        quantity: 45,
        previousQuantity: 40,
      },
    ];
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(history);

    const result = await api.getHistory(SUB_ID);

    expect(client.get).toHaveBeenCalledWith(`/subscriptions/${SUB_ID}/history`);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("QuantityChanged");
  });

  it("update sends correct body", async () => {
    const updated = { ...sampleSubscription, quantity: 50 };
    (client.put as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.update(SUB_ID, { quantity: 50 });

    expect(client.put).toHaveBeenCalledWith(`/subscriptions/${SUB_ID}`, { quantity: 50 });
    expect(result.quantity).toBe(50);
  });

  it("delete calls client delete", async () => {
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await api.delete(SUB_ID);

    // No `cancelDate` → no query string forwarded.
    expect(client.delete).toHaveBeenCalledWith(`/subscriptions/${SUB_ID}`, undefined);
  });

  // #333: spec types `cancelDate` as `format: date-time`. The CLI surface
  // takes `YYYY-MM-DD` for partner ergonomics; the API client normalizes
  // it to `YYYY-MM-DDT00:00:00Z` before the wire call so the wire payload
  // matches the spec.
  it("delete normalizes YYYY-MM-DD cancelDate to ISO date-time on the wire (#333)", async () => {
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await api.delete(SUB_ID, { cancelDate: "2026-12-31" });

    expect(client.delete).toHaveBeenCalledWith(
      `/subscriptions/${SUB_ID}`,
      { cancelDate: "2026-12-31T00:00:00Z" },
    );
  });

  it("delete passes through an already-formatted ISO date-time unchanged (#333)", async () => {
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const iso = "2026-12-31T01:30:00.000-05:00";
    await api.delete(SUB_ID, { cancelDate: iso });

    expect(client.delete).toHaveBeenCalledWith(
      `/subscriptions/${SUB_ID}`,
      { cancelDate: iso },
    );
  });

  describe("normalizeCancelDateForWire (#333)", () => {
    it("promotes YYYY-MM-DD to midnight-UTC date-time", () => {
      expect(normalizeCancelDateForWire("2026-12-31")).toBe(
        "2026-12-31T00:00:00Z",
      );
    });

    it("passes through full ISO date-time strings unchanged", () => {
      expect(normalizeCancelDateForWire("2026-12-31T00:00:00Z")).toBe(
        "2026-12-31T00:00:00Z",
      );
      expect(
        normalizeCancelDateForWire("2026-12-31T01:30:00.000-05:00"),
      ).toBe("2026-12-31T01:30:00.000-05:00");
    });
  });

  it("throws on invalid response data", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ bad: "data" });

    await expect(api.get(SUB_ID)).rejects.toThrow();
  });
});
