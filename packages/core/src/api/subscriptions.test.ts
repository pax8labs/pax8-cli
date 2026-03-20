import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubscriptionsApi } from "./subscriptions.js";
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

const SUB_ID = "d4e5f6a7-b8c9-0123-defa-456789012345";
const COMPANY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PRODUCT_ID = "f6a7b8c9-0123-4567-89ab-cdef01234567";

const sampleSubscription = {
  id: SUB_ID,
  companyId: COMPANY_ID,
  productId: PRODUCT_ID,
  quantity: 45,
  startDate: "2025-01-01",
  createdDate: "2025-01-01",
  status: "Active",
  price: 22.50,
  billingTerm: "Annual",
  commitmentTermEndDate: "2026-01-01",
};

const samplePaginatedResponse = {
  page: { size: 50, totalElements: 1, totalPages: 1, number: 0 },
  content: [sampleSubscription],
};

describe("SubscriptionsApi", () => {
  let client: Pax8Client;
  let api: SubscriptionsApi;

  beforeEach(() => {
    client = createMockClient();
    api = new SubscriptionsApi(client);
  });

  it("list returns paginated subscriptions", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedResponse);

    const result = await api.list({ companyId: COMPANY_ID });

    expect(client.get).toHaveBeenCalledWith("/subscriptions", { companyId: COMPANY_ID });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].quantity).toBe(45);
  });

  it("get returns a single subscription", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleSubscription);

    const result = await api.get(SUB_ID);

    expect(client.get).toHaveBeenCalledWith(`/subscriptions/${SUB_ID}`);
    expect(result.status).toBe("Active");
  });

  it("getHistory returns subscription history", async () => {
    const history = [
      {
        id: "e5f6a7b8-c9d0-1234-5678-9abcdef01234",
        action: "QuantityChanged",
        date: "2025-06-15",
        quantity: 45,
        previousQuantity: 40,
      },
    ];
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(history);

    const result = await api.getHistory(SUB_ID);

    expect(client.get).toHaveBeenCalledWith(`/subscriptions/${SUB_ID}/history`);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("QuantityChanged");
  });

  it("update sends correct body", async () => {
    const updated = { ...sampleSubscription, quantity: 50 };
    (client.put as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.update(SUB_ID, { quantity: 50 });

    expect(client.put).toHaveBeenCalledWith(`/subscriptions/${SUB_ID}`, { quantity: 50 });
    expect(result.quantity).toBe(50);
  });

  it("delete calls client delete", async () => {
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await api.delete(SUB_ID);

    expect(client.delete).toHaveBeenCalledWith(`/subscriptions/${SUB_ID}`);
  });

  it("throws on invalid response data", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ bad: "data" });

    await expect(api.get(SUB_ID)).rejects.toThrow();
  });
});
