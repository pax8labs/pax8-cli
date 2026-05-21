// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("E2E: Product discovery — search and pricing", () => {
  it("pax8 products list shows products", async () => {
    const result = await runCliExpectSuccess(["products", "list"]);
    expect(result.stdout.length).toBeGreaterThan(0);
    // #483: wrapped envelope { products, page }.
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.products)).toBe(true);
    expect(data.products.length).toBeGreaterThan(0);
  });

  it('pax8 products search "Microsoft" returns matching products', async () => {
    const result = await runCliExpectSuccess(["products", "search", "Microsoft"]);
    expect(result.stdout.length).toBeGreaterThan(0);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.products)).toBe(true);
    expect(data.products.length).toBeGreaterThan(0);
    // All results should contain "Microsoft" in the product name
    for (const product of data.products) {
      expect(product.name.toLowerCase()).toContain("microsoft");
    }
  });

  it("pax8 products list --json produces valid JSON", async () => {
    const result = await runCliExpectSuccess(["products", "list", "--json"]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.products)).toBe(true);
    expect(data.products.length).toBeGreaterThan(0);
    expect(data.products[0]).toHaveProperty("id");
    expect(data.products[0]).toHaveProperty("name");
    expect(data.products[0]).toHaveProperty("vendorName");
  });
});
