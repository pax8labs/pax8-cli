// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContactsApi } from "./contacts.js";
import type { Pax8Client } from "./client.js";

function createMockClient(): Pax8Client {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getPaginated: vi.fn(),
  } as unknown as Pax8Client;
}

const COMPANY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const CONTACT_ID = "f1e2d3c4-b5a6-7890-abcd-ef1234567890";

const sampleContact = {
  id: CONTACT_ID,
  firstName: "John",
  lastName: "Doe",
  email: "john@example.com",
  phone: "555-0100",
  companyId: COMPANY_ID,
  // Spec shape (#325): array of `{type, primary}` objects, not bare strings.
  types: [{ type: "Admin", primary: true }],
};

const samplePaginatedResponse = {
  page: { size: 50, totalElements: 1, totalPages: 1, number: 0 },
  content: [sampleContact],
};

describe("ContactsApi", () => {
  let client: Pax8Client;
  let api: ContactsApi;

  beforeEach(() => {
    client = createMockClient();
    api = new ContactsApi(client);
  });

  it("list hits nested /companies/{companyId}/contacts", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedResponse);

    const result = await api.list(COMPANY_ID, { page: 0, size: 50 });

    expect(client.get).toHaveBeenCalledWith(
      `/companies/${COMPANY_ID}/contacts`,
      { page: 0, size: 50 },
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0].firstName).toBe("John");
  });

  it("get hits nested /companies/{companyId}/contacts/{contactId}", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleContact);

    const result = await api.get(COMPANY_ID, CONTACT_ID);

    expect(client.get).toHaveBeenCalledWith(
      `/companies/${COMPANY_ID}/contacts/${CONTACT_ID}`,
    );
    expect(result.id).toBe(CONTACT_ID);
    expect(result.email).toBe("john@example.com");
  });

  it("create POSTs to nested /companies/{companyId}/contacts with spec-shaped body (no companyId, types as {type, primary}[])", async () => {
    const input = {
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.com",
      phone: "555-0123",
      types: [{ type: "Billing" as const, primary: false }],
    };
    const created = {
      ...sampleContact,
      ...input,
      id: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(created);

    const result = await api.create(COMPANY_ID, input);

    expect(client.post).toHaveBeenCalledWith(
      `/companies/${COMPANY_ID}/contacts`,
      input,
    );
    // Belt-and-suspenders: the body must not carry `companyId` — that
    // duplicates the URL path and the spec doesn't declare it as a body
    // field. See #325.
    const sentBody = (client.post as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(sentBody).not.toHaveProperty("companyId");
    expect(result.firstName).toBe("Jane");
  });

  it("update PUTs to nested /companies/{companyId}/contacts/{contactId} with the full spec body", async () => {
    // #325: the spec uses PUT (not PATCH) with required scalars. The CLI
    // fetch-then-merges before calling this method, so we receive a full
    // body here.
    const input = {
      firstName: "Updated",
      lastName: "Doe",
      email: "john@example.com",
      phone: "555-0100",
      types: [{ type: "Admin" as const, primary: true }],
    };
    const updated = { ...sampleContact, firstName: "Updated" };
    (client.put as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.update(COMPANY_ID, CONTACT_ID, input);

    expect(client.put).toHaveBeenCalledWith(
      `/companies/${COMPANY_ID}/contacts/${CONTACT_ID}`,
      input,
    );
    const sentBody = (client.put as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(sentBody).not.toHaveProperty("companyId");
    expect(sentBody).toHaveProperty("firstName");
    expect(sentBody).toHaveProperty("lastName");
    expect(sentBody).toHaveProperty("email");
    expect(sentBody).toHaveProperty("phone");
    expect(result.firstName).toBe("Updated");
  });

  it("delete hits nested /companies/{companyId}/contacts/{contactId}", async () => {
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await api.delete(COMPANY_ID, CONTACT_ID);

    expect(client.delete).toHaveBeenCalledWith(
      `/companies/${COMPANY_ID}/contacts/${CONTACT_ID}`,
    );
  });
});
