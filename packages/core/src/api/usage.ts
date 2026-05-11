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
      params as Record<string, string | number | undefined>,
    );
    return PaginatedUsageSummarySchema.parse(raw);
  }

  async getSummary(id: string): Promise<UsageSummary> {
    const raw = await this.client.get<unknown>(`/usage-summaries/${id}`);
    return UsageSummarySchema.parse(raw);
  }

  /**
   * List per-resource line items for a usage summary.
   *
   * Wire path: `GET /v1/usage-summaries/{id}/usage-lines`. The leaf segment
   * is `usage-lines` (not `lines`) per the spec — prior to this fix the CLI
   * hit `/lines`, which 404s against the real Pax8 API.
   */
  async listLines(
    summaryId: string,
    params?: { page?: number; size?: number },
  ): Promise<PaginatedResponse<UsageLine>> {
    const raw = await this.client.get<unknown>(
      `/usage-summaries/${summaryId}/usage-lines`,
      params as Record<string, string | number | undefined>,
    );
    return PaginatedUsageLineSchema.parse(raw);
  }
}
