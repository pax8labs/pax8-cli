// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("E2E: Billing workflow — invoice and audit", () => {
  it("pax8 invoices list shows invoices", async () => {
    const result = await runCliExpectSuccess(["invoices", "list"]);
    expect(result.stdout.length).toBeGreaterThan(0);
    // #483: wrapped envelope { invoices, page }.
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.invoices)).toBe(true);
    expect(data.invoices.length).toBeGreaterThan(0);
  });

  it("pax8 invoices list --json produces valid JSON", async () => {
    const result = await runCliExpectSuccess(["invoices", "list", "--json"]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.invoices)).toBe(true);
    expect(data.invoices.length).toBeGreaterThan(0);
    expect(data.invoices[0]).toHaveProperty("id");
    expect(data.invoices[0]).toHaveProperty("total");
    expect(data.invoices[0]).toHaveProperty("status");
  });

  it("pax8 invoices items --json produces valid { items, page } envelope", async () => {
    const result = await runCliExpectSuccess(["invoices", "items", "--json"]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items[0]).toHaveProperty("id");
    expect(data.items[0]).toHaveProperty("quantity");
    expect(data.items[0]).toHaveProperty("price");
  });

  it("pax8 invoices audit shows discrepancy report", async () => {
    const result = await runCliExpectSuccess(["invoices", "audit"]);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("pax8 invoices audit --json produces valid JSON with discrepancies array", async () => {
    const result = await runCliExpectSuccess(["invoices", "audit", "--json"]);
    const raw = JSON.parse(result.stdout);
    // output() wraps in array; unwrap if needed
    const data = Array.isArray(raw) ? raw[0] : raw;
    expect(data).toHaveProperty("discrepancies");
    expect(Array.isArray(data.discrepancies)).toBe(true);
    expect(data).toHaveProperty("totalOvercharge");
    expect(data).toHaveProperty("totalUndercharge");
    expect(data).toHaveProperty("netImpact");
    expect(data).toHaveProperty("itemsAudited");
  });
});
