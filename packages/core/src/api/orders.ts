// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Pax8Client, RequestOpts } from "./client.js";
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
    /**
     * #478: server-side sort, `<field>,<direction>`. Callers use the
     * canonical `createdAt` (the `Order` field); it's rewritten to the wire
     * name `createdDate` before sending, because the live API answers
     * `sort=createdAt,…` with an immediate 500 while `createdDate,desc`
     * works (verified 2026-11-05). Other fields pass through unchanged.
     */
    sort?: string;
  }, opts?: RequestOpts): Promise<PaginatedResponse<Order>> {
    const wireParams = params?.sort
      ? { ...params, sort: toWireSort(params.sort) }
      : params;
    const raw = await this.client.get<unknown>(
      "/orders",
      wireParams as Record<string, string | number | undefined>,
      opts,
    );
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

/** Canonical → wire sort field names for `GET /orders`. */
const ORDER_SORT_WIRE_FIELDS: Record<string, string> = { createdAt: "createdDate" };

export function toWireSort(sort: string): string {
  const [field = "", ...rest] = sort.split(",");
  const wire = ORDER_SORT_WIRE_FIELDS[field.trim()] ?? field.trim();
  return [wire, ...rest.map((r) => r.trim())].join(",");
}

/**
 * `GET /orders` is slow server-side: ~32s even at `size=1` on a 5,352-order
 * tenant (2026-11-05), past the 30s default timeout, so every attempt timed
 * out and retries stretched a call to ~2 minutes. Callers fetching orders
 * pass this, unless the partner set `PAX8_TIMEOUT_MS` explicitly.
 */
export const ORDERS_LIST_TIMEOUT_MS = 90_000;

export function ordersListRequestOpts(): RequestOpts | undefined {
  return process.env.PAX8_TIMEOUT_MS ? undefined : { timeoutMs: ORDERS_LIST_TIMEOUT_MS };
}
