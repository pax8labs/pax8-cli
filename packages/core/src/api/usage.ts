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

  async listSummaries(params?: {
    page?: number;
    size?: number;
    companyId?: string;
    resourceGroup?: string;
  }): Promise<PaginatedResponse<UsageSummary>> {
    const raw = await this.client.get<unknown>("/usage-summaries", params as Record<string, string | number | undefined>);
    return PaginatedUsageSummarySchema.parse(raw);
  }

  async getSummary(id: string): Promise<UsageSummary> {
    const raw = await this.client.get<unknown>(`/usage-summaries/${id}`);
    return UsageSummarySchema.parse(raw);
  }

  async listLines(
    summaryId: string,
    params?: { page?: number; size?: number },
  ): Promise<PaginatedResponse<UsageLine>> {
    const raw = await this.client.get<unknown>(
      `/usage-summaries/${summaryId}/lines`,
      params as Record<string, string | number | undefined>,
    );
    return PaginatedUsageLineSchema.parse(raw);
  }
}
