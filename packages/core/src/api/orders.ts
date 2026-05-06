// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Pax8Client } from "./client.js";
import {
  OrderSchema,
  PaginatedResponseSchema,
  type Order,
  type CreateOrderInput,
  type PaginatedResponse,
} from "./types.js";

const PaginatedOrderSchema = PaginatedResponseSchema(OrderSchema);

export class OrdersApi {
  constructor(private client: Pax8Client) {}

  async list(params?: {
    page?: number;
    size?: number;
    companyId?: string;
    status?: string;
  }): Promise<PaginatedResponse<Order>> {
    const raw = await this.client.get<unknown>("/orders", params as Record<string, string | number | undefined>);
    return PaginatedOrderSchema.parse(raw);
  }

  async get(id: string): Promise<Order> {
    const raw = await this.client.get<unknown>(`/orders/${id}`);
    return OrderSchema.parse(raw);
  }

  async create(data: CreateOrderInput): Promise<Order> {
    const raw = await this.client.post<unknown>("/orders", data);
    return OrderSchema.parse(raw);
  }
}
