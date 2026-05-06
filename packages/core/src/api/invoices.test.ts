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
  unitPrice: 22.0,
  subtotal: 990.0,
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
});
