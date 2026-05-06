import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("pax8 invoices", () => {
  describe("invoices list", () => {
    it("lists invoices in demo mode", async () => {
      const result = await runCliExpectSuccess(["invoices", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("companyName");
      expect(data[0]).toHaveProperty("total");
      expect(data[0]).toHaveProperty("status");
    });

    it("filters by month", async () => {
      // Get current month in YYYY-MM format
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      const result = await runCliExpectSuccess([
        "invoices",
        "list",
        "--month",
        currentMonth,
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const inv of data) {
        expect(inv.invoiceDate).toContain(currentMonth);
      }
    });

    it("filters by company", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "list",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const inv of data) {
        expect(inv.companyId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      }
    });

    it("--with-actions wraps in { invoices, nextActions }", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "list",
        "--json",
        "--with-actions",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("invoices");
      expect(data).toHaveProperty("nextActions");
      expect(Array.isArray(data.invoices)).toBe(true);
      expect(Array.isArray(data.nextActions)).toBe(true);
      expect(data.nextActions.length).toBeGreaterThan(0);
      for (const action of data.nextActions) {
        expect(action).toHaveProperty("command");
        expect(action).toHaveProperty("description");
      }
    });
  });

  describe("invoices show", () => {
    it("shows invoice detail in JSON", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "show",
        "inv-summit-curr-001",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data[0]).toHaveProperty("id", "inv-summit-curr-001");
      expect(data[0]).toHaveProperty("companyName", "Summit Healthcare Partners");
      expect(data[0]).toHaveProperty("total");
      expect(data[0]).toHaveProperty("status");
      expect(data[0]).toHaveProperty("balance");
      expect(data[0]).toHaveProperty("currency");
    });
  });

  describe("invoices items", () => {
    it("lists invoice items in demo mode", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "items",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("productName");
      expect(data[0]).toHaveProperty("quantity");
      expect(data[0]).toHaveProperty("unitPrice");
      expect(data[0]).toHaveProperty("subtotal");
    });

    it("filters items by invoice ID", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "items",
        "--invoice-id",
        "inv-summit-curr-001",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const item of data) {
        expect(item.invoiceId).toBe("inv-summit-curr-001");
      }
    });
  });

  describe("invoices audit", () => {
    it("produces audit report in JSON", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "audit",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data[0]).toHaveProperty("discrepancies");
      expect(data[0]).toHaveProperty("totalOvercharge");
      expect(data[0]).toHaveProperty("totalUndercharge");
      expect(data[0]).toHaveProperty("netImpact");
      expect(data[0]).toHaveProperty("itemsAudited");
      expect(data[0].discrepancies.length).toBeGreaterThan(0);
    });

    it("each discrepancy has required fields", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "audit",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      const disc = data[0].discrepancies[0];
      expect(disc).toHaveProperty("companyName");
      expect(disc).toHaveProperty("productName");
      expect(disc).toHaveProperty("invoicedQuantity");
      expect(disc).toHaveProperty("activeQuantity");
      expect(disc).toHaveProperty("delta");
      expect(disc).toHaveProperty("dollarImpact");
      expect(disc).toHaveProperty("type");
    });
  });

  describe("invoices --help", () => {
    it("shows invoices subcommands", async () => {
      const result = await runCliExpectSuccess(["invoices", "--help"]);
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("show");
      expect(result.stdout).toContain("items");
      expect(result.stdout).toContain("audit");
    });
  });
});
