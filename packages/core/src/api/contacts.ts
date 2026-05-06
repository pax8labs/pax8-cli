// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Pax8Client } from "./client.js";
import {
  ContactSchema,
  PaginatedResponseSchema,
  type Contact,
  type CreateContactInput,
  type PaginatedResponse,
  type UpdateContactInput,
} from "./types.js";

const PaginatedContactSchema = PaginatedResponseSchema(ContactSchema);

export class ContactsApi {
  constructor(private client: Pax8Client) {}

  async list(
    companyId: string,
    params?: { page?: number; size?: number },
  ): Promise<PaginatedResponse<Contact>> {
    const raw = await this.client.get<unknown>(`/companies/${companyId}/contacts`, params as Record<string, string | number | undefined>);
    return PaginatedContactSchema.parse(raw);
  }

  async get(id: string): Promise<Contact> {
    const raw = await this.client.get<unknown>(`/contacts/${id}`);
    return ContactSchema.parse(raw);
  }

  async create(data: CreateContactInput): Promise<Contact> {
    const raw = await this.client.post<unknown>("/contacts", data);
    return ContactSchema.parse(raw);
  }

  async update(id: string, data: UpdateContactInput): Promise<Contact> {
    const raw = await this.client.put<unknown>(`/contacts/${id}`, data);
    return ContactSchema.parse(raw);
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(`/contacts/${id}`);
  }
}
