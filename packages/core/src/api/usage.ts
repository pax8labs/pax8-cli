// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Pax8Client } from "./client.js";
import {
  UsageSummarySchema,
  UsageLineSchema,
  PaginatedResponseSchema,
  type UsageSummary,
  type UsageLine,
  type PaginatedResponse,
} from "./types.js";

const PaginatedUsageSummarySchema = PaginatedResponseSchema(UsageSummarySchema);
const PaginatedUsageLineSchema = PaginatedResponseSchema(UsageLineSchema);

export class UsageApi {
  constructor(private client: Pax8Client) {}

  /**
   * List usage summaries for a specific subscription.
   *
   * Wire path: `GET /v1/subscriptions/{subscriptionId}/usage-summaries`.
   * The Pax8 public spec does not expose a flat top-level `/usage-summaries`
   * list — summaries are always scoped to a single subscription. Callers that
   * want a per-company or cross-tenant view must resolve subscriptions first
   * (e.g. via `pax8 subscriptions list --company X`) and iterate.
   * Sorting is fixed to resourceGroup ascending — a documented sort that the
   * live API accepts. Don't expose `currentCharges` / `partnerTotal` sorts:
   * they're documented but the live API answers 500 for both, with or
   * without a direction (verified 2026-11-05).
   */
  async listSummaries(
    subscriptionId: string,
    params?: {
      page?: number;
      size?: number;
      resourceGroup?: string;
    },
  ): Promise<PaginatedResponse<UsageSummary>> {
    const raw = await this.client.get<unknown>(
      `/subscriptions/${subscriptionId}/usage-summaries`,
      {
        ...params,
        // Explicit, known-good sort. See the doc comment for the sorts that 500.
        sort: "resourceGroup,asc",
      },
    );
    return PaginatedUsageSummarySchema.parse(raw);
  }

  async getSummary(id: string): Promise<UsageSummary> {
    const raw = await this.client.get<unknown>(`/usage-summaries/${id}`);
    return UsageSummarySchema.parse(raw);
  }

  /**
   * List one day's usage lines for a usage summary.
   *
   * Wire path: `GET /v1/usage-summaries/{id}/usage-lines?usageDate=YYYY-MM-DD`.
   * The leaf segment is `usage-lines` (not `lines`) per the spec. `usageDate`
   * is required: the live API answers 400 without it and 409 for a bare
   * `YYYY-MM` (verified 2026-11-05). No documented sort parameter.
   */
  async listLines(
    summaryId: string,
    params: { usageDate: string; productId?: string; page?: number; size?: number },
  ): Promise<PaginatedResponse<UsageLine>> {
    const raw = await this.client.get<unknown>(
      `/usage-summaries/${summaryId}/usage-lines`,
      params,
    );
    return PaginatedUsageLineSchema.parse(raw);
  }
}
