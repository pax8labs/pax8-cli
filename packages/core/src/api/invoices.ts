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
    companyId?: string;
  }): Promise<PaginatedResponse<Invoice>> {
    const raw = await this.client.get<unknown>("/invoices", params as Record<string, string | number | undefined>);
    return PaginatedInvoiceSchema.parse(raw);
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
