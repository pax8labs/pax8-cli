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

export class CompaniesApi {
  constructor(private client: Pax8Client) {}

  async list(params?: { page?: number; size?: number; status?: string; filter?: string }): Promise<PaginatedResponse<Company>> {
    const raw = await this.client.get<unknown>("/companies", params as Record<string, string | number | undefined>);
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
