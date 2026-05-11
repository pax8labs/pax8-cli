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

/**
 * Pax8 Contacts API.
 *
 * Wire paths are always nested under `/companies/{companyId}/contacts` per the
 * Pax8 public spec. There is no flat `/contacts` endpoint at any version —
 * every method threads `companyId` into the URL path.
 */
export class ContactsApi {
  constructor(private client: Pax8Client) {}

  async list(
    companyId: string,
    params?: { page?: number; size?: number },
  ): Promise<PaginatedResponse<Contact>> {
    const raw = await this.client.get<unknown>(
      `/companies/${companyId}/contacts`,
      params as Record<string, string | number | undefined>,
    );
    return PaginatedContactSchema.parse(raw);
  }

  async get(companyId: string, contactId: string): Promise<Contact> {
    const raw = await this.client.get<unknown>(
      `/companies/${companyId}/contacts/${contactId}`,
    );
    return ContactSchema.parse(raw);
  }

  async create(companyId: string, data: CreateContactInput): Promise<Contact> {
    const raw = await this.client.post<unknown>(
      `/companies/${companyId}/contacts`,
      data,
    );
    return ContactSchema.parse(raw);
  }

  async update(
    companyId: string,
    contactId: string,
    data: UpdateContactInput,
  ): Promise<Contact> {
    const raw = await this.client.put<unknown>(
      `/companies/${companyId}/contacts/${contactId}`,
      data,
    );
    return ContactSchema.parse(raw);
  }

  async delete(companyId: string, contactId: string): Promise<void> {
    await this.client.delete(
      `/companies/${companyId}/contacts/${contactId}`,
    );
  }
}
