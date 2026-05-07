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

  /**
   * Create a new order.
   *
   * `opts.isMock=true` appends `?isMock=true` to the request, telling the
   * Pax8 API to validate (dry-run) the order without committing it. The
   * response shape is the same as a real create — partners can preview
   * what the order would look like before placing it for real.
   */
  async create(
    data: CreateOrderInput,
    opts?: { isMock?: boolean },
  ): Promise<Order> {
    const path = opts?.isMock ? "/orders?isMock=true" : "/orders";
    const raw = await this.client.post<unknown>(path, data);
    return OrderSchema.parse(raw);
  }
}
