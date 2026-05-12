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

  // #388: every spec-defined query parameter on `GET /companies` must be
  // forwarded verbatim. Booleans serialize as the string "true" / "false" on
  // the wire (Pax8Client's query-param shape is `string | number`); we coerce
  // them in CompaniesApi.list rather than forcing CLI callers to pre-stringify.
  it("list forwards geography + capability + sort params to GET (#388)", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedResponse);

    await api.list({
      page: 0,
      size: 25,
      status: "Active",
      city: "Denver",
      country: "US",
      stateOrProvince: "CO",
      postalCode: "80202",
      selfServiceAllowed: true,
      billOnBehalfOfEnabled: false,
      orderApprovalRequired: true,
      sort: "city",
    });

    expect(client.get).toHaveBeenCalledWith("/companies", {
      page: 0,
      size: 25,
      status: "Active",
      city: "Denver",
      country: "US",
      stateOrProvince: "CO",
      postalCode: "80202",
      selfServiceAllowed: "true",
      billOnBehalfOfEnabled: "false",
      orderApprovalRequired: "true",
      sort: "city",
    });
  });

  it("list with no params still forwards an empty object", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedResponse);

    await api.list();

    expect(client.get).toHaveBeenCalledWith("/companies", {});
  });

  it("get returns a single company", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleCompany);

    const result = await api.get(COMPANY_ID);

    expect(client.get).toHaveBeenCalledWith(`/companies/${COMPANY_ID}`);
    expect(result.id).toBe(COMPANY_ID);
    expect(result.name).toBe("Acme Corp");
  });

  it("create sends correct body and returns company", async () => {
    // Spec-required shape: address with `stateOrProvince` and `postalCode`
    // (renamed from `state` / `zip` in #327), plus the three billing booleans
    // that were previously `.optional()` (#329).
    const input = {
      name: "New Corp",
      phone: "555-0100",
      website: "https://newcorp.example.com",
      address: {
        street: "1 Main",
        city: "Denver",
        stateOrProvince: "CO",
        postalCode: "80202",
        country: "US",
      },
      billOnBehalfOfEnabled: false,
      selfServiceAllowed: false,
      orderApprovalRequired: false,
    };
    const created = { ...sampleCompany, id: "b2c3d4e5-f6a7-8901-bcde-f12345678901", name: "New Corp" };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(created);

    const result = await api.create(input);

    // The exact body must include `stateOrProvince` / `postalCode` and all
    // three billing booleans. Pin the shape so a future regression to
    // `state` / `zip` (or to dropping the booleans) shows up here.
    expect(client.post).toHaveBeenCalledWith("/companies", input);
    const sentBody = (client.post as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
    const sentAddress = sentBody.address as Record<string, unknown>;
    expect(sentAddress).toHaveProperty("stateOrProvince", "CO");
    expect(sentAddress).toHaveProperty("postalCode", "80202");
    expect(sentAddress).not.toHaveProperty("state");
    expect(sentAddress).not.toHaveProperty("zip");
    expect(sentBody).toHaveProperty("billOnBehalfOfEnabled", false);
    expect(sentBody).toHaveProperty("selfServiceAllowed", false);
    expect(sentBody).toHaveProperty("orderApprovalRequired", false);
    expect(result.name).toBe("New Corp");
  });

  it("get parses address with stateOrProvince and postalCode (not state/zip)", async () => {
    // Read-side companion to #327: the API returns `stateOrProvince` and
    // `postalCode` on `Address`. Pre-#328 Zod silently dropped these (the
    // schema parsed `state` / `zip`) — this test pins the new behavior.
    const apiResponse = {
      id: COMPANY_ID,
      name: "Acme Corp",
      address: {
        street: "123 Main St",
        city: "Denver",
        stateOrProvince: "CO",
        postalCode: "80202",
        country: "US",
      },
    };
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(apiResponse);

    const result = await api.get(COMPANY_ID);

    expect(result.address?.stateOrProvince).toBe("CO");
    expect(result.address?.postalCode).toBe("80202");
  });

  it("get drops legacy state/zip wire keys (Zod strips unknowns)", async () => {
    // Defensive: if a stale server still sends `state` / `zip` (or a partner
    // crafts a payload using the old names), the schema should silently strip
    // them. The fix is on the spec-conformant side — partners need the new
    // names — but we don't want stale data leaking through as `address.state`.
    const apiResponse = {
      id: COMPANY_ID,
      name: "Acme Corp",
      address: {
        street: "123 Main St",
        city: "Denver",
        state: "CO",
        zip: "80202",
        country: "US",
      },
    };
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(apiResponse);

    const result = await api.get(COMPANY_ID);

    expect(result.address?.stateOrProvince).toBeUndefined();
    expect(result.address?.postalCode).toBeUndefined();
    // `state` / `zip` are unknown keys — Zod strips them, so they're not on
    // the parsed object either.
    expect(result.address as unknown as { state?: string }).not.toHaveProperty("state");
    expect(result.address as unknown as { zip?: string }).not.toHaveProperty("zip");
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
