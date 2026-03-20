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
  types: ["Admin"],
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

  it("list returns paginated contacts for a company", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedResponse);

    const result = await api.list(COMPANY_ID, { page: 0, size: 50 });

    expect(client.get).toHaveBeenCalledWith(
      `/companies/${COMPANY_ID}/contacts`,
      { page: 0, size: 50 },
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0].firstName).toBe("John");
  });

  it("get returns a single contact", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleContact);

    const result = await api.get(CONTACT_ID);

    expect(client.get).toHaveBeenCalledWith(`/contacts/${CONTACT_ID}`);
    expect(result.id).toBe(CONTACT_ID);
    expect(result.email).toBe("john@example.com");
  });

  it("create sends correct body and returns contact", async () => {
    const input = {
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.com",
      companyId: COMPANY_ID,
      types: ["Billing" as const],
    };
    const created = { ...sampleContact, ...input, id: "b2c3d4e5-f6a7-8901-bcde-f12345678901" };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(created);

    const result = await api.create(input);

    expect(client.post).toHaveBeenCalledWith("/contacts", input);
    expect(result.firstName).toBe("Jane");
  });

  it("update sends correct body and returns contact", async () => {
    const input = { firstName: "Updated" };
    const updated = { ...sampleContact, firstName: "Updated" };
    (client.put as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.update(CONTACT_ID, input);

    expect(client.put).toHaveBeenCalledWith(`/contacts/${CONTACT_ID}`, input);
    expect(result.firstName).toBe("Updated");
  });

  it("delete calls client.delete", async () => {
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await api.delete(CONTACT_ID);

    expect(client.delete).toHaveBeenCalledWith(`/contacts/${CONTACT_ID}`);
  });
});
