// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProductsApi } from "./products.js";
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

const PRODUCT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const sampleProduct = {
  id: PRODUCT_ID,
  name: "Microsoft 365 Business Premium [New Commerce Experience]",
  vendorName: "Microsoft",
  sku: "M365-BP",
};

const samplePricingResponse = {
  content: [
    {
      productId: PRODUCT_ID,
      billingTerm: "Monthly",
      commitmentTerm: "Monthly",
      commitmentTermInMonths: 1,
      type: "Flat",
      unitOfMeasurement: "User",
      rates: [
        { partnerBuyRate: 22.0, suggestedRetailPrice: 25.0, startQuantityRange: 0, chargeType: "Per Unit" },
      ],
    },
  ],
};

// Spec-shaped envelope per `findProvisionDetailsByProductId` in
// partner-endpoints.json: `{ content: ProvisioningDetail[] }` where each
// detail carries `{ key, label?, description?, valueType?, possibleValues?,
// values? }`. The pre-fix shape (`{ productId, vendorPrerequisites, fields }`)
// was hallucinated; see Candidate H in docs/triage/v0.1.0-candidates.md.
const sampleProvisioningResponse = {
  content: [
    {
      key: "domain",
      label: "Tenant Domain",
      description: "Customer's verified Microsoft tenant domain.",
      valueType: "Input",
      possibleValues: null,
    },
    {
      key: "plan",
      label: "Plan",
      description: "Select the partner plan tier.",
      valueType: "Single-Value",
      possibleValues: ["basic", "standard"],
    },
  ],
};

const samplePaginatedResponse = {
  page: { size: 50, totalElements: 1, totalPages: 1, number: 0 },
  content: [sampleProduct],
};

describe("ProductsApi", () => {
  let client: Pax8Client;
  let api: ProductsApi;

  beforeEach(() => {
    client = createMockClient();
    api = new ProductsApi(client);
  });

  it("list returns paginated products", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePaginatedResponse);

    const result = await api.list({ page: 0, size: 50, vendorName: "Microsoft" });

    expect(client.get).toHaveBeenCalledWith("/products", { page: 0, size: 50, vendorName: "Microsoft" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].name).toBe("Microsoft 365 Business Premium [New Commerce Experience]");
  });

  it("get returns a single product", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleProduct);

    const result = await api.get(PRODUCT_ID);

    expect(client.get).toHaveBeenCalledWith(`/products/${PRODUCT_ID}`);
    expect(result.vendorName).toBe("Microsoft");
  });

  it("getPricing returns product pricing plans", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(samplePricingResponse);

    const result = await api.getPricing(PRODUCT_ID);

    expect(client.get).toHaveBeenCalledWith(`/products/${PRODUCT_ID}/pricing`);
    expect(result).toHaveLength(1);
    expect(result[0].billingTerm).toBe("Monthly");
    expect(result[0].rates[0].partnerBuyRate).toBe(22.0);
  });

  it("getProvisioningDetails returns spec-shaped provisioning fields", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleProvisioningResponse);

    const result = await api.getProvisioningDetails(PRODUCT_ID);

    // Path regression: spec is `/provision-details` (singular). The pre-fix
    // path was `/provisioning-details` (plural-with-hyphen) and 404'd against
    // the real API — see Candidate H.
    expect(client.get).toHaveBeenCalledWith(`/products/${PRODUCT_ID}/provision-details`);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("domain");
    expect(result[0].valueType).toBe("Input");
    expect(result[0].possibleValues).toBeNull();
    expect(result[1].key).toBe("plan");
    expect(result[1].valueType).toBe("Single-Value");
    expect(result[1].possibleValues).toEqual(["basic", "standard"]);
  });

  it("getProvisioningDetails calls the spec'd path /provision-details", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ content: [] });

    await api.getProvisioningDetails(PRODUCT_ID);

    const calls = (client.get as ReturnType<typeof vi.fn>).mock.calls;
    const path = calls[0][0] as string;
    expect(path).toBe(`/products/${PRODUCT_ID}/provision-details`);
    expect(path).not.toContain("provisioning-details");
  });

  it("getDependencies returns dependency array", async () => {
    const deps = [
      {
        id: "c3d4e5f6-a7b8-9012-cdef-123456789012",
        productId: PRODUCT_ID,
        dependsOnProductId: "d4e5f6a7-b890-1234-cdef-567890123456",
        dependencyType: "Required",
      },
    ];
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(deps);

    const result = await api.getDependencies(PRODUCT_ID);

    expect(client.get).toHaveBeenCalledWith(`/products/${PRODUCT_ID}/dependencies`);
    expect(result).toHaveLength(1);
  });
});
