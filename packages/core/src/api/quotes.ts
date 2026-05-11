// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Pax8Client, RequestOpts } from "./client.js";
import {
  QuoteSchema,
  PaginatedResponseSchema,
  type Quote,
  type CreateQuoteInput,
  type UpdateQuoteInput,
  type AddQuoteLineItemInput,
  type QuoteStatusTransition,
  type PaginatedResponse,
} from "./types.js";

const PaginatedQuoteSchema = PaginatedResponseSchema(QuoteSchema);

/**
 * Per-call routing options for `QuotesApi`. Quotes are the only Pax8 partner
 * surface that lives at `/v2`; every other resource uses the default `/v1`
 * from the shared base URL. The `Pax8Client` accepts a `RequestOpts` argument
 * with `apiVersion` to override the version segment per call — every call in
 * this class passes `V2`. See #307 and `docs/triage/quotes-api-version.md`.
 *
 * Body shapes for the remaining write endpoints are tracked separately under
 * the `quotes-v2-body-shape` label (#312, #313, #314). The `create` body
 * shape (`{ clientId, quoteRequestId? }`) was reconciled in #311.
 */
const V2: RequestOpts = { apiVersion: "v2" };

export class QuotesApi {
  constructor(private client: Pax8Client) {}

  async list(params?: {
    page?: number;
    size?: number;
    companyId?: string;
  }): Promise<PaginatedResponse<Quote>> {
    const raw = await this.client.get<unknown>(
      "/quotes",
      params as Record<string, string | number | undefined>,
      V2,
    );
    return PaginatedQuoteSchema.parse(raw);
  }

  async get(id: string): Promise<Quote> {
    const raw = await this.client.get<unknown>(`/quotes/${id}`, undefined, V2);
    return QuoteSchema.parse(raw);
  }

  /**
   * Create an empty quote. Per the v2 spec (`POST /v2/quotes`), the body is
   * `{ clientId, quoteRequestId? }` and **line items are not accepted on
   * create** — they must be appended via `addLineItem` after the quote
   * exists. The CLI's `quotes create` orchestrates that two-call flow when
   * the user passes `--product`. See #311 and
   * `docs/triage/quotes-api-version.md` §9.1.
   */
  async create(data: CreateQuoteInput): Promise<Quote> {
    const raw = await this.client.post<unknown>("/quotes", data, V2);
    return QuoteSchema.parse(raw);
  }

  async update(id: string, data: UpdateQuoteInput): Promise<Quote> {
    const raw = await this.client.put<unknown>(`/quotes/${id}`, data, V2);
    return QuoteSchema.parse(raw);
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(`/quotes/${id}`, undefined, V2);
  }

  /**
   * Append a single line item to a draft quote.
   *
   * `POST /v2/quotes/{quoteId}/line-items` accepts an array of mixed-type
   * payloads (Standard / Custom / UsageBased). We post a single Standard
   * line and re-fetch the quote so callers always get the canonical post-
   * mutation state — the upstream response shape is `LineItemResponse[]`,
   * which doesn't include the surrounding quote-level fields callers care
   * about (totals, status).
   */
  async addLineItem(quoteId: string, input: AddQuoteLineItemInput): Promise<Quote> {
    const payload = [
      {
        type: "Standard",
        productId: input.productId,
        quantity: input.quantity,
        ...(input.billingTerm ? { billingTerm: input.billingTerm } : {}),
      },
    ];
    await this.client.post<unknown>(`/quotes/${quoteId}/line-items`, payload, V2);
    return this.get(quoteId);
  }

  /**
   * Remove a single line item from a quote.
   * `DELETE /v2/quotes/{quoteId}/line-items/{lineItemId}` returns 204.
   */
  async removeLineItem(quoteId: string, lineItemId: string): Promise<void> {
    await this.client.delete(`/quotes/${quoteId}/line-items/${lineItemId}`, undefined, V2);
  }

  /**
   * Transition a quote to a new status.
   *
   * Most commonly used as `setStatus(id, "sent")` — the trigger that publishes
   * the customer-facing quote and (server-side) emits the customer link/email.
   * Backed by `PUT /v2/quotes/{quoteId}` per the v2 quoting OpenAPI spec.
   */
  async setStatus(id: string, status: QuoteStatusTransition): Promise<Quote> {
    const raw = await this.client.put<unknown>(`/quotes/${id}`, { status }, V2);
    return QuoteSchema.parse(raw);
  }

  /** Convenience wrapper: `setStatus(id, "sent")`. */
  async send(id: string): Promise<Quote> {
    return this.setStatus(id, "sent");
  }
}
