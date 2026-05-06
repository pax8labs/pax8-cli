// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Pax8Client } from "./client.js";
import {
  QuoteSchema,
  PaginatedResponseSchema,
  type Quote,
  type CreateQuoteInput,
  type UpdateQuoteInput,
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
}
