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
   *
   * Auto-injects `lineItemNumber` on every line item that doesn't provide
   * one: the spec's `CreateLineItem` schema marks `lineItemNumber` as
   * required (used by `parentLineItemNumber` to express child line items),
   * but the CLI doesn't expose it as user-facing input. We assign 1-based
   * sequential numbers (1, 2, 3, ...) matching array position. Callers that
   * do supply `lineItemNumber` explicitly (e.g. for parent/child line-item
   * orderings the CLI doesn't construct today) have their values preserved.
   * See issue #331.
   */
  async create(
    data: CreateOrderInput,
    opts?: { isMock?: boolean },
  ): Promise<Order> {
    const path = opts?.isMock ? "/orders?isMock=true" : "/orders";
    const payload = {
      ...data,
      lineItems: data.lineItems.map((li, idx) => ({
        ...li,
        lineItemNumber: li.lineItemNumber ?? idx + 1,
      })),
    };
    const raw = await this.client.post<unknown>(path, payload);
    return OrderSchema.parse(raw);
  }
}
