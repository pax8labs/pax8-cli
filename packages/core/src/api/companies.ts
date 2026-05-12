// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Pax8Client } from "./client.js";
import {
  CompanySchema,
  PaginatedResponseSchema,
  type Company,
  type CreateCompanyInput,
  type PaginatedResponse,
  type UpdateCompanyInput,
} from "./types.js";

const PaginatedCompanySchema = PaginatedResponseSchema(CompanySchema);

/**
 * Sort fields supported by `GET /companies?sort=`. Spec-canonical names; the
 * CLI maps shorter UX names (`state`, `zip`) onto `stateOrProvince` /
 * `postalCode` at the command layer. See #388.
 */
export type CompaniesSort =
  | "name"
  | "city"
  | "country"
  | "stateOrProvince"
  | "postalCode";

export interface CompaniesListParams {
  page?: number;
  size?: number;
  status?: string;
  // ─── Geography filters (#388) ─────────────────────────────────────────────
  /** Spec field name; the CLI surfaces this as `--city`. */
  city?: string;
  /** Spec field name; the CLI surfaces this as `--country`. */
  country?: string;
  /** Spec field name; the CLI surfaces the shorter `--state`. */
  stateOrProvince?: string;
  /** Spec field name; the CLI surfaces the shorter `--zip`. */
  postalCode?: string;
  // ─── Capability filters (#388) ────────────────────────────────────────────
  selfServiceAllowed?: boolean;
  billOnBehalfOfEnabled?: boolean;
  orderApprovalRequired?: boolean;
  // ─── Sort (#388) ──────────────────────────────────────────────────────────
  sort?: CompaniesSort;
}

export class CompaniesApi {
  constructor(private client: Pax8Client) {}

  /**
   * List companies with optional server-side filters.
   *
   * Per OpenAPI (`partner-endpoints.json` → `GET /companies`), the spec
   * supports geography (`city` / `country` / `stateOrProvince` / `postalCode`),
   * capability booleans (`selfServiceAllowed`, `billOnBehalfOfEnabled`,
   * `orderApprovalRequired`), and a `sort` enum. Pre-#388 the API client
   * accepted a generic `filter` parameter with no spec backing — it has been
   * dropped (no deprecation since the package is pre-v0.1.0).
   */
  async list(params?: CompaniesListParams): Promise<PaginatedResponse<Company>> {
    // The shared `Pax8Client.get` query-param shape is `string | number |
    // undefined`. Boolean spec params get serialized as "true" / "false" on
    // the wire — coerce explicitly here so the caller-facing TypeScript
    // surface stays `boolean` (more ergonomic than forcing the CLI to pass
    // pre-stringified flags). Undefined values are passed through unchanged
    // so the URL builder can drop them.
    const wireParams: Record<string, string | number | undefined> = params
      ? (Object.fromEntries(
          Object.entries(params).map(([k, v]) =>
            typeof v === "boolean" ? [k, v ? "true" : "false"] : [k, v],
          ),
        ) as Record<string, string | number | undefined>)
      : {};
    const raw = await this.client.get<unknown>("/companies", wireParams);
    return PaginatedCompanySchema.parse(raw);
  }

  async get(id: string): Promise<Company> {
    const raw = await this.client.get<unknown>(`/companies/${id}`);
    return CompanySchema.parse(raw);
  }

  async create(data: CreateCompanyInput): Promise<Company> {
    const raw = await this.client.post<unknown>("/companies", data);
    return CompanySchema.parse(raw);
  }

  async update(id: string, data: UpdateCompanyInput): Promise<Company> {
    const raw = await this.client.patch<unknown>(`/companies/${id}`, data);
    return CompanySchema.parse(raw);
  }
}
