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
    // #398: the spec's `GET /subscriptions` exposes `billingTerm`, `productId`,
    // and `sort` query params. The CLI previously skipped them, forcing
    // partners with large portfolios to download then filter client-side.
    billingTerm?: string;
    productId?: string;
    /**
     * Spec-typed as a freeform string for forward-compat (the spec doesn't
     * enumerate accepted sort keys); the CLI surface canonicalizes the
     * known fields (`quantity`, `startDate`, `endDate`, `createdAt`) plus
     * direction (`,asc` / `,desc`).
     */
    sort?: string;
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

  /**
   * Cancel a subscription. By default the cancellation is immediate; pass
   * `cancelDate` to schedule the cancellation for a future date — the Pax8
   * API forwards it as the `cancelDate` query parameter.
   *
   * Wire-format note (#333): the Pax8 OpenAPI spec types `cancelDate` as
   * `format: date-time` (RFC 3339 / ISO 8601 with a zone offset, e.g.
   * `2026-12-31T00:00:00Z`). The CLI surface accepts user-friendly
   * `YYYY-MM-DD`; this method normalizes that shape to `YYYY-MM-DDT00:00:00Z`
   * before forwarding so the wire payload matches the spec. Full
   * `date-time` strings (with `T` and offset) are passed through unchanged,
   * letting callers that already hold an ISO timestamp use it as-is.
   *
   * Same defensive-normalization approach #312 used for `effectiveDate` on
   * `quotes line-items add`.
   */
  async delete(id: string, params?: { cancelDate?: string }): Promise<void> {
    const query = params?.cancelDate
      ? { cancelDate: normalizeCancelDateForWire(params.cancelDate) }
      : undefined;
    await this.client.delete(`/subscriptions/${id}`, query);
  }
}

/**
 * Normalize a `cancelDate` value to the RFC 3339 / ISO 8601 `date-time`
 * shape the Pax8 API spec requires (`format: date-time` on the
 * `cancelDate` query parameter of `DELETE /subscriptions/{id}`).
 *
 * - `YYYY-MM-DD` → `YYYY-MM-DDT00:00:00Z` (midnight UTC of the given day).
 *   Pinning to UTC midnight avoids day-shift bugs when the caller's local
 *   zone differs from the API's interpretation.
 * - Strings already containing `T` are assumed to be full ISO `date-time`
 *   and are passed through unchanged — callers that already hold a
 *   timestamp shouldn't have it rewritten.
 *
 * Exported for the unit test that pins the wire shape.
 */
export function normalizeCancelDateForWire(raw: string): string {
  // Date-only shape `YYYY-MM-DD` — promote to midnight-UTC date-time.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T00:00:00Z`;
  }
  // Anything else is treated as already-formatted ISO date-time and
  // passed through. Validation of arbitrary input happens at the CLI
  // boundary (`packages/cli/src/commands/subscriptions/cancel.ts`).
  return raw;
}
