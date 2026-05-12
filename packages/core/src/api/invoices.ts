// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

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

/**
 * Sort fields supported by `GET /invoices?sort=`. Spec-canonical names from
 * `partner-endpoints.json` → `GET /invoices` `sort` enum. The CLI accepts
 * shorter kebab-cased aliases (e.g. `invoice-date` → `invoiceDate`) and maps
 * them onto these values at the command layer. See #389.
 */
export type InvoicesSort =
  | "invoiceDate"
  | "dueDate"
  | "status"
  | "partnerName"
  | "total"
  | "balance"
  | "carriedBalance";

export interface InvoicesListParams {
  page?: number;
  size?: number;
  // ─── Existing params ──────────────────────────────────────────────────────
  invoiceDate?: string;
  /** Convenience alias for `invoiceDate` accepted on YYYY-MM input. */
  month?: string;
  companyId?: string;
  status?: string;
  // ─── New filter params (#389) ─────────────────────────────────────────────
  /** Server-side date range (yyyy-MM-dd). Spec param name. */
  invoiceDateRangeStart?: string;
  /** Server-side date range (yyyy-MM-dd). Spec param name. */
  invoiceDateRangeEnd?: string;
  /** Filter to a specific due date (yyyy-MM-dd). */
  dueDate?: string;
  /** Filter by exact total amount. */
  total?: number;
  /** Filter by exact balance amount. */
  balance?: number;
  /** Filter by exact carriedBalance amount. */
  carriedBalance?: number;
  /** Sort by spec enum value. */
  sort?: InvoicesSort;
}

export class InvoicesApi {
  constructor(private client: Pax8Client) {}

  /**
   * List invoices with optional server-side filters.
   *
   * Per OpenAPI (`partner-endpoints.json` → `GET /invoices`), the spec
   * supports `status` (enum), `sort` (enum), date-range parameters
   * (`invoiceDateRangeStart` / `invoiceDateRangeEnd`), a specific `dueDate`,
   * and numeric `total` / `balance` / `carriedBalance` exact-match filters.
   * Pre-#389 the API client accepted only `invoiceDate`, `month`, `companyId`,
   * and `status` — partners couldn't filter by overdue date or sort by status.
   */
  async list(params?: InvoicesListParams): Promise<PaginatedResponse<Invoice>> {
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

  /**
   * List invoice line items.
   *
   * Supports two call shapes for parity with the mock client:
   * - `listItems(invoiceId, params)` — items for a specific invoice (the
   *   real Pax8 endpoint).
   * - `listItems({ invoiceId, companyId, month, ... })` — items across
   *   invoices, filtered client-side after fetching the candidate set.
   */
  async listItems(
    idOrParams?: string | { page?: number; size?: number; invoiceId?: string; companyId?: string; month?: string },
    params?: { page?: number; size?: number },
  ): Promise<PaginatedResponse<InvoiceItem>> {
    if (typeof idOrParams === "string") {
      const raw = await this.client.get<unknown>(
        `/invoices/${idOrParams}/items`,
        params as Record<string, string | number | undefined>,
      );
      return PaginatedInvoiceItemSchema.parse(raw);
    }

    // Aggregate-mode: the upstream API doesn't expose a global items list,
    // so list invoices matching the filters and concatenate their items.
    const opts = idOrParams ?? {};
    if (opts.invoiceId) {
      const raw = await this.client.get<unknown>(
        `/invoices/${opts.invoiceId}/items`,
        { page: opts.page, size: opts.size } as Record<string, string | number | undefined>,
      );
      return PaginatedInvoiceItemSchema.parse(raw);
    }

    const invoiceList = await this.list({
      page: 0,
      size: 100,
      companyId: opts.companyId,
      month: opts.month,
    });
    const items: InvoiceItem[] = [];
    for (const inv of invoiceList.content) {
      const page = await this.client.get<unknown>(
        `/invoices/${inv.id}/items`,
        { size: 200 } as Record<string, string | number | undefined>,
      );
      const parsed = PaginatedInvoiceItemSchema.parse(page);
      items.push(...parsed.content);
    }

    const pageNum = opts.page ?? 0;
    const pageSize = opts.size ?? items.length;
    const start = pageNum * pageSize;
    const slice = items.slice(start, start + pageSize);
    return {
      content: slice,
      page: {
        number: pageNum,
        totalPages: Math.max(1, Math.ceil(items.length / Math.max(pageSize, 1))),
        totalElements: items.length,
        size: pageSize,
      },
    };
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
