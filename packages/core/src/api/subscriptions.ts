// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Pax8Client } from "./client.js";
import { z } from "zod";
import {
  SubscriptionSchema,
  SubscriptionHistorySchema,
  PaginatedResponseSchema,
  type Subscription,
  type SubscriptionHistory,
  type UpdateSubscriptionInput,
  type PaginatedResponse,
} from "./types.js";

const PaginatedSubscriptionSchema = PaginatedResponseSchema(SubscriptionSchema);

export class SubscriptionsApi {
  constructor(private client: Pax8Client) {}

  async list(params?: {
    page?: number;
    size?: number;
    companyId?: string;
    status?: string;
  }): Promise<PaginatedResponse<Subscription>> {
    const raw = await this.client.get<unknown>("/subscriptions", params as Record<string, string | number | undefined>);
    return PaginatedSubscriptionSchema.parse(raw);
  }

  async get(id: string): Promise<Subscription> {
    const raw = await this.client.get<unknown>(`/subscriptions/${id}`);
    return SubscriptionSchema.parse(raw);
  }

  async getHistory(id: string): Promise<SubscriptionHistory[]> {
    const raw = await this.client.get<unknown>(`/subscriptions/${id}/history`);
    return z.array(SubscriptionHistorySchema).parse(raw);
  }

  async update(id: string, data: UpdateSubscriptionInput): Promise<Subscription> {
    const raw = await this.client.put<unknown>(`/subscriptions/${id}`, data);
    return SubscriptionSchema.parse(raw);
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(`/subscriptions/${id}`);
  }
}
