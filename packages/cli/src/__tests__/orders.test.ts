// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("pax8 orders", () => {
  describe("orders list", () => {
    it("returns order data in JSON format", async () => {
      const result = await runCliExpectSuccess(["orders", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("companyName");
      expect(data[0]).toHaveProperty("status");
      expect(data[0]).toHaveProperty("createdDate");
    });

    it("outputs data by default (non-TTY falls back to JSON)", async () => {
      const result = await runCliExpectSuccess(["orders", "list"]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].id).toBe("ord-summit-001");
    });

    it("filters by company ID", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "list",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const order of data) {
        expect(order.companyId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      }
    });

    it("supports pagination", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "list",
        "--page",
        "1",
        "--size",
        "2",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBe(2);
    });

    it("shows footer with order count on stderr", async () => {
      const result = await runCliExpectSuccess(["orders", "list"]);
      expect(result.stderr).toContain("orders");
    });
  });

  describe("orders show", () => {
    it("returns order details in JSON format", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "show",
        "ord-summit-001",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.id).toBe("ord-summit-001");
      expect(data.companyName).toBe("Summit Healthcare Partners");
      expect(data.status).toBe("Completed");
      expect(data.lineItems).toBeDefined();
      expect(data.lineItems.length).toBeGreaterThan(0);
    });

    it("shows order with line items", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "show",
        "ord-summit-001",
      ]);
      // Non-TTY defaults to JSON
      const data = JSON.parse(result.stdout);
      expect(data.lineItems[0].productName).toBe("CrowdStrike MSSP Complete Defend");
      expect(data.lineItems[0].quantity).toBe(85);
    });

    it("shows order with multiple line items", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "show",
        "ord-pinnacle-001",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.lineItems.length).toBe(2);
      expect(data.lineItems[0].productName).toContain("Microsoft 365");
      expect(data.lineItems[1].productName).toContain("Defender");
    });
  });

  describe("orders --help", () => {
    it("shows orders subcommands", async () => {
      const result = await runCliExpectSuccess(["orders", "--help"]);
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("show");
      expect(result.stdout).toContain("create");
    });

    it("shows list help with examples", async () => {
      const result = await runCliExpectSuccess(["orders", "list", "--help"]);
      expect(result.stdout).toContain("Examples:");
      expect(result.stdout).toContain("--company");
      expect(result.stdout).toContain("--page");
    });

    it("shows show help with examples", async () => {
      const result = await runCliExpectSuccess(["orders", "show", "--help"]);
      expect(result.stdout).toContain("Examples:");
    });

    it("shows create help with required options", async () => {
      const result = await runCliExpectSuccess(["orders", "create", "--help"]);
      expect(result.stdout).toContain("--company");
      expect(result.stdout).toContain("--product");
      expect(result.stdout).toContain("Examples:");
    });
  });

  describe("orders create validation", () => {
    it("errors when --company flag is missing", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--product",
        "prod-m365-biz-prem-0001",
      ]);
      expect(result.stderr).toContain("--company");
    });

    it("errors when --product flag is missing", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      ]);
      expect(result.stderr).toContain("--product");
    });

    it("errors with invalid quantity", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--product",
        "prod-m365-biz-prem-0001",
        "--quantity",
        "-5",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/[Ii]nvalid quantity/);
    });

    // Regression for #230: when a product requires a commitment term (every
    // pricing plan has commitmentTerm) AND the customer has no existing
    // subscription for that product (so resolveCommitmentTermId can't copy a
    // UUID), the order command must fail at preview-time with a clear,
    // actionable error — NOT proceed to a misleading preview ("Commitment:
    // Monthly") and only fail after the user confirmed and the API rejected.
    //
    // Acme Corp does not have an M365 E3 subscription in the demo fixtures;
    // M365 E3 has commitmentTerm on every pricing plan. Together that
    // triggers the pre-flight check.
    it("fails clearly when product requires commitment but no existing subscription (#230)", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "Acme Corp",
        "--product",
        "prod-m365-e3-0003",
        "--quantity",
        "1",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      // Error is surfaced before the preview/confirm — there is no "Order
      // Preview" or "Place order" prompt in the output.
      expect(combined).not.toMatch(/Place order/);
      // The error names the actual failure mode and includes recovery steps.
      expect(combined).toMatch(/requires.*commitment/i);
      expect(combined).toMatch(/--commitment-term/);
      expect(combined).toMatch(/Pax8 portal/);
    });
  });
});
