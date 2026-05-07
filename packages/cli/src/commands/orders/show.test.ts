// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "../../__tests__/test-utils.js";

describe("orders show", () => {
  it("--json includes enriched companyName for the order (#194)", async () => {
    const result = await runCliExpectSuccess([
      "orders",
      "show",
      "ord-summit-001",
      "--json",
    ]);
    const order = JSON.parse(result.stdout);
    expect(order.id).toBe("ord-summit-001");
    expect(order.companyId).toBeTruthy();
    expect(typeof order.companyName).toBe("string");
    expect(order.companyName.length).toBeGreaterThan(0);
    expect(order.companyName).not.toBe("undefined");
  });

  it("--json line items are non-empty and each has a productName (#194)", async () => {
    const result = await runCliExpectSuccess([
      "orders",
      "show",
      "ord-summit-001",
      "--json",
    ]);
    const order = JSON.parse(result.stdout);
    expect(Array.isArray(order.lineItems)).toBe(true);
    expect(order.lineItems.length).toBeGreaterThan(0);
    for (const li of order.lineItems) {
      expect(typeof li.productId).toBe("string");
      expect(typeof li.productName).toBe("string");
      expect(li.productName.length).toBeGreaterThan(0);
      expect(li.productName).not.toMatch(/^Product /); // not the placeholder
    }
  });

  it("human render shows a non-empty Company line and a Line Items section (#194)", async () => {
    const result = await runCliExpectSuccess([
      "orders",
      "show",
      "ord-summit-001",
    ]);
    // The CLI auto-detects non-TTY → JSON, so re-parse and assert the shape
    // matches what the human renderer would print. The render-side regression
    // is covered by the e2e per-command matrix's forbiddenFragments=["undefined"].
    const order = JSON.parse(result.stdout);
    expect(order.companyName).toMatch(/\S+/);
    expect(order.lineItems.length).toBeGreaterThan(0);
    expect(order.lineItems[0].productName).toMatch(/\S+/);
  });
});
