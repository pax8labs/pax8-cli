// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Pax8Client } from "./client.js";
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

export class QuotesApi {
  constructor(private client: Pax8Client) {}

  async list(params?: {
    page?: number;
    size?: number;
    companyId?: string;
  }): Promise<PaginatedResponse<Quote>> {
    const raw = await this.client.get<unknown>("/quotes", params as Record<string, string | number | undefined>);
    return PaginatedQuoteSchema.parse(raw);
  }

  async get(id: string): Promise<Quote> {
    const raw = await this.client.get<unknown>(`/quotes/${id}`);
    return QuoteSchema.parse(raw);
  }

  async create(data: CreateQuoteInput): Promise<Quote> {
    const raw = await this.client.post<unknown>("/quotes", data);
    return QuoteSchema.parse(raw);
  }

  async update(id: string, data: UpdateQuoteInput): Promise<Quote> {
    const raw = await this.client.put<unknown>(`/quotes/${id}`, data);
    return QuoteSchema.parse(raw);
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(`/quotes/${id}`);
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
    await this.client.post<unknown>(`/quotes/${quoteId}/line-items`, payload);
    return this.get(quoteId);
  }

  /**
   * Remove a single line item from a quote.
   * `DELETE /v2/quotes/{quoteId}/line-items/{lineItemId}` returns 204.
   */
  async removeLineItem(quoteId: string, lineItemId: string): Promise<void> {
    await this.client.delete(`/quotes/${quoteId}/line-items/${lineItemId}`);
  }

  /**
   * Transition a quote to a new status.
   *
   * Most commonly used as `setStatus(id, "sent")` — the trigger that publishes
   * the customer-facing quote and (server-side) emits the customer link/email.
   * Backed by `PUT /v2/quotes/{quoteId}` per the v2 quoting OpenAPI spec.
   */
  async setStatus(id: string, status: QuoteStatusTransition): Promise<Quote> {
    const raw = await this.client.put<unknown>(`/quotes/${id}`, { status });
    return QuoteSchema.parse(raw);
  }

  /** Convenience wrapper: `setStatus(id, "sent")`. */
  async send(id: string): Promise<Quote> {
    return this.setStatus(id, "sent");
  }
}
