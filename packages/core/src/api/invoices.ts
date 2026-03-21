import type { Pax8Client } from "./client.js";
import {
  InvoiceSchema,
  InvoiceItemSchema,
  PaginatedResponseSchema,
  type Invoice,
  type InvoiceItem,
  type PaginatedResponse,
} from "./types.js";

const PaginatedInvoiceSchema = PaginatedResponseSchema(InvoiceSchema);
const PaginatedInvoiceItemSchema = PaginatedResponseSchema(InvoiceItemSchema);

export class InvoicesApi {
  constructor(private client: Pax8Client) {}

  async list(params?: {
    page?: number;
    size?: number;
    invoiceDate?: string;
    month?: string;
    companyId?: string;
    status?: string;
  }): Promise<PaginatedResponse<Invoice>> {
    // Map 'month' to 'invoiceDate' for the API
    const apiParams: Record<string, string | number | undefined> = { ...params };
    if (params?.month && !params?.invoiceDate) {
      apiParams.invoiceDate = params.month;
    }
    delete apiParams.month;
    const raw = await this.client.get<unknown>("/invoices", apiParams);

    // The Pax8 invoices endpoint omits `content` when there are no results
    const obj = raw as Record<string, unknown>;
    if (obj.page && !obj.content) {
      obj.content = [];
    }
    return PaginatedInvoiceSchema.parse(obj);
  }

  async get(id: string): Promise<Invoice> {
    const raw = await this.client.get<unknown>(`/invoices/${id}`);
    return InvoiceSchema.parse(raw);
  }

  async listItems(
    id: string,
    params?: { page?: number; size?: number },
  ): Promise<PaginatedResponse<InvoiceItem>> {
    const raw = await this.client.get<unknown>(
      `/invoices/${id}/items`,
      params as Record<string, string | number | undefined>,
    );
    return PaginatedInvoiceItemSchema.parse(raw);
  }

  async listDraftItems(params?: {
    page?: number;
    size?: number;
    companyId?: string;
  }): Promise<PaginatedResponse<InvoiceItem>> {
    const raw = await this.client.get<unknown>("/invoices/draft-items", params as Record<string, string | number | undefined>);
    return PaginatedInvoiceItemSchema.parse(raw);
  }
}
