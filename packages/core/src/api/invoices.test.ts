// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { InvoicesApi } from "./invoices.js";
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

const INVOICE_ID = "e5f6a7b8-c9d0-1234-5678-9abcdef01234";
const COMPANY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const sampleInvoice = {
  id: INVOICE_ID,
  companyId: COMPANY_ID,
  invoiceDate: "2026-03-01",
  dueDate: "2026-03-31",
  status: "Unpaid",
  total: 2450.0,
  balance: 2450.0,
  companyName: "Acme Corp",
};

const sampleInvoiceItem = {
  id: "f6a7b8c9-d0e1-2345-6789-abcdef012345",
  invoiceId: INVOICE_ID,
  productId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  quantity: 45,
  price: 22.0,
  subTotal: 990.0,
  productName: "Microsoft 365 Business Premium [New Commerce Experience]",
};

const samplePaginatedInvoices = {
  page: { size: 50, totalElements: 1, totalPages: 1, number: 0 },
  content: [sampleInvoice],
};

const samplePaginatedItems = {
  page: { size: 50, totalElements: 1, totalPages: 1, number: 0 },
  content: [sampleInvoiceItem],
};

describe("InvoicesApi", () => {
  let client: Pax8Client;
  let api: InvoicesApi;

  beforeEach(() => {
    client = createMockClient();
    api = new InvoicesApi(client);
  });

  it("list returns paginated invoices", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedInvoices);

    const result = await api.list({ invoiceDate: "2026-03", companyId: COMPANY_ID });

    expect(client.get).toHaveBeenCalledWith("/invoices", {
      invoiceDate: "2026-03",
      companyId: COMPANY_ID,
    });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].total).toBe(2450.0);
  });

  // #389: spec adds `sort`, `invoiceDateRangeStart`/`End`, `dueDate`,
  // `total`/`balance`/`carriedBalance` query parameters. The API client
  // must forward all of them verbatim — the CLI maps friendly names like
  // `--from` / `--to` / `--sort due-date` onto these wire fields.
  it("list forwards #389 spec params to GET", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedInvoices);

    await api.list({
      page: 0,
      size: 25,
      status: "Unpaid",
      invoiceDateRangeStart: "2026-01-01",
      invoiceDateRangeEnd: "2026-03-31",
      dueDate: "2026-03-31",
      total: 2450.0,
      balance: 2450.0,
      carriedBalance: 0,
      sort: "dueDate",
    });

    expect(client.get).toHaveBeenCalledWith("/invoices", {
      page: 0,
      size: 25,
      status: "Unpaid",
      invoiceDateRangeStart: "2026-01-01",
      invoiceDateRangeEnd: "2026-03-31",
      dueDate: "2026-03-31",
      total: 2450.0,
      balance: 2450.0,
      carriedBalance: 0,
      sort: "dueDate",
    });
  });

  it("list still maps `month` to `invoiceDate` for backwards compatibility (#389)", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedInvoices);

    await api.list({ month: "2026-03" });

    // Backwards compatibility: callers passing `--month` continue to see it
    // remapped to `invoiceDate` on the wire — pre-#389 behavior preserved.
    expect(client.get).toHaveBeenCalledWith("/invoices", { invoiceDate: "2026-03" });
  });

  it("get returns a single invoice", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleInvoice);

    const result = await api.get(INVOICE_ID);

    expect(client.get).toHaveBeenCalledWith(`/invoices/${INVOICE_ID}`);
    expect(result.companyName).toBe("Acme Corp");
  });

  it("listItems returns paginated invoice items", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedItems);

    const result = await api.listItems(INVOICE_ID, { page: 0, size: 50 });

    expect(client.get).toHaveBeenCalledWith(`/invoices/${INVOICE_ID}/items`, { page: 0, size: 50 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].productName).toBe("Microsoft 365 Business Premium [New Commerce Experience]");
  });

  it("listDraftItems returns paginated draft items", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedItems);

    const result = await api.listDraftItems({ companyId: COMPANY_ID });

    expect(client.get).toHaveBeenCalledWith("/invoices/draft-items", { companyId: COMPANY_ID });
    expect(result.content).toHaveLength(1);
  });

  it("throws on invalid response data", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ not: "an invoice" });

    await expect(api.get(INVOICE_ID)).rejects.toThrow();
  });

  // #393: branch-coverage push for InvoicesApi. The pre-fix module reported
  // 38% branch coverage — the no-params path, the empty-content envelope,
  // and the multi-branch `listItems` aggregate mode were never exercised.

  it("list() with no params still issues a GET (covers the no-params branch)", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedInvoices);
    await api.list();
    expect(client.get).toHaveBeenCalledWith("/invoices", {});
  });

  it("list() prefers an explicit `invoiceDate` over `month` when both are passed", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedInvoices);
    await api.list({ month: "2026-01", invoiceDate: "2026-03" });
    const params = (client.get as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, string>;
    expect(params.invoiceDate).toBe("2026-03");
    expect(params.month).toBeUndefined();
  });

  it("list() tolerates an empty-result envelope (no `content` field)", async () => {
    // Pax8 omits `content` on the wire when there are zero invoices.
    // The API client defensively injects `content: []` so the Zod parse
    // doesn't blow up the caller.
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      page: { size: 50, totalElements: 0, totalPages: 0, number: 0 },
    });
    const result = await api.list({ status: "Unpaid" });
    expect(result.content).toEqual([]);
    expect(result.page.totalElements).toBe(0);
  });

  it("listItems() in object-mode with no invoiceId fans out across the company's invoices", async () => {
    // Two invoices exist for the company; the aggregate path lists them
    // and concatenates each one's items.
    (client.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        page: { size: 100, totalElements: 2, totalPages: 1, number: 0 },
        content: [
          { ...sampleInvoice, id: "inv-1" },
          { ...sampleInvoice, id: "inv-2" },
        ],
      })
      .mockResolvedValueOnce({
        page: { size: 200, totalElements: 1, totalPages: 1, number: 0 },
        content: [{ ...sampleInvoiceItem, invoiceId: "inv-1" }],
      })
      .mockResolvedValueOnce({
        page: { size: 200, totalElements: 1, totalPages: 1, number: 0 },
        content: [{ ...sampleInvoiceItem, id: "item-2", invoiceId: "inv-2" }],
      });

    const result = await api.listItems({ companyId: COMPANY_ID });
    expect(result.content).toHaveLength(2);
    expect(result.page.totalElements).toBe(2);
    // First call lists invoices; second + third fetch each invoice's items.
    expect((client.get as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/invoices");
    expect((client.get as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe("/invoices/inv-1/items");
    expect((client.get as ReturnType<typeof vi.fn>).mock.calls[2][0]).toBe("/invoices/inv-2/items");
  });

  it("listItems() with object-mode + explicit invoiceId short-circuits to that invoice's items", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedItems);
    await api.listItems({ invoiceId: INVOICE_ID, page: 1, size: 20 });
    // Only one upstream call — no fan-out when invoiceId is explicit.
    expect((client.get as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    const [path, params] = (client.get as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe(`/invoices/${INVOICE_ID}/items`);
    expect(params).toEqual({ page: 1, size: 20 });
  });

  it("listItems() with no arguments returns an empty page (covers the `idOrParams ?? {}` fallback)", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      page: { size: 100, totalElements: 0, totalPages: 0, number: 0 },
      content: [],
    });
    const result = await api.listItems();
    expect(result.content).toEqual([]);
    // First call goes through the aggregate path's invoice listing.
    expect((client.get as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/invoices");
  });

  it("listItems() paginates the aggregated items array client-side", async () => {
    // Fan out across one invoice that has 3 items; ask for page=1 size=2 — we
    // expect to see items[2] (the third one) on the slice.
    (client.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        page: { size: 100, totalElements: 1, totalPages: 1, number: 0 },
        content: [{ ...sampleInvoice, id: "inv-multi" }],
      })
      .mockResolvedValueOnce({
        page: { size: 200, totalElements: 3, totalPages: 1, number: 0 },
        content: [
          { ...sampleInvoiceItem, id: "i1" },
          { ...sampleInvoiceItem, id: "i2" },
          { ...sampleInvoiceItem, id: "i3" },
        ],
      });

    const result = await api.listItems({ companyId: COMPANY_ID, page: 1, size: 2 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].id).toBe("i3");
    expect(result.page.totalElements).toBe(3);
    expect(result.page.totalPages).toBe(2);
  });
});
