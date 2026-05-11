// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CompaniesApi } from "./companies.js";
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

const sampleCompany = {
  id: COMPANY_ID,
  name: "Acme Corp",
  status: "Active",
  phone: "555-0100",
  website: "https://acme.com",
};

const samplePaginatedResponse = {
  page: { size: 50, totalElements: 1, totalPages: 1, number: 0 },
  content: [sampleCompany],
};

describe("CompaniesApi", () => {
  let client: Pax8Client;
  let api: CompaniesApi;

  beforeEach(() => {
    client = createMockClient();
    api = new CompaniesApi(client);
  });

  it("list returns paginated companies", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedResponse);

    const result = await api.list({ page: 0, size: 50 });

    expect(client.get).toHaveBeenCalledWith("/companies", { page: 0, size: 50 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].name).toBe("Acme Corp");
    expect(result.page.totalElements).toBe(1);
  });

  it("get returns a single company", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleCompany);

    const result = await api.get(COMPANY_ID);

    expect(client.get).toHaveBeenCalledWith(`/companies/${COMPANY_ID}`);
    expect(result.id).toBe(COMPANY_ID);
    expect(result.name).toBe("Acme Corp");
  });

  it("create sends correct body and returns company", async () => {
    const input = { name: "New Corp" };
    const created = { ...sampleCompany, id: "b2c3d4e5-f6a7-8901-bcde-f12345678901", name: "New Corp" };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(created);

    const result = await api.create(input);

    expect(client.post).toHaveBeenCalledWith("/companies", input);
    expect(result.name).toBe("New Corp");
  });

  it("update sends correct body and returns company via PATCH", async () => {
    const input = { name: "Updated Corp" };
    const updated = { ...sampleCompany, name: "Updated Corp" };
    (client.patch as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.update(COMPANY_ID, input);

    expect(client.patch).toHaveBeenCalledWith(`/companies/${COMPANY_ID}`, input);
    expect(client.put).not.toHaveBeenCalled();
    expect(result.name).toBe("Updated Corp");
  });

  it("throws on 404 (Zod parse fails on invalid data)", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ invalid: true });

    await expect(api.get(COMPANY_ID)).rejects.toThrow();
  });
});
