import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

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
        "0",
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
});
