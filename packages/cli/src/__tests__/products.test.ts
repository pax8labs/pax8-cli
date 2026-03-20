import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

describe("pax8 products", () => {
  describe("products list", () => {
    it("lists products in demo mode", async () => {
      const result = await runCliExpectSuccess(["products", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("vendorName");
      expect(data[0]).toHaveProperty("sku");
    });

    it("filters by vendor", async () => {
      const result = await runCliExpectSuccess([
        "products",
        "list",
        "--vendor",
        "Acronis",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const p of data) {
        expect(p.vendorName.toLowerCase()).toContain("acronis");
      }
    });

    it("respects --size option", async () => {
      const result = await runCliExpectSuccess([
        "products",
        "list",
        "--size",
        "2",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeLessThanOrEqual(2);
    });
  });

  describe("products show", () => {
    it("shows product detail in JSON", async () => {
      const result = await runCliExpectSuccess([
        "products",
        "show",
        "prod-m365-biz-prem-0001",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data[0]).toHaveProperty("name", "Microsoft 365 Business Premium");
      expect(data[0]).toHaveProperty("vendorName", "Microsoft");
    });

    it("shows pricing with --pricing flag", async () => {
      const result = await runCliExpectSuccess([
        "products",
        "show",
        "prod-m365-biz-prem-0001",
        "--pricing",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data[0]).toHaveProperty("pricingDetails");
      expect(data[0].pricingDetails.length).toBeGreaterThan(0);
    });

    it("shows provisioning with --provisioning flag", async () => {
      const result = await runCliExpectSuccess([
        "products",
        "show",
        "prod-m365-biz-prem-0001",
        "--provisioning",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data[0]).toHaveProperty("provisioningDetails");
      expect(data[0].provisioningDetails).toHaveProperty("requiresDomain");
    });

    it("shows dependencies with --dependencies flag", async () => {
      const result = await runCliExpectSuccess([
        "products",
        "show",
        "prod-m365-biz-prem-0001",
        "--dependencies",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data[0]).toHaveProperty("dependencies");
    });
  });

  describe("products search", () => {
    it("finds products matching query", async () => {
      const result = await runCliExpectSuccess([
        "products",
        "search",
        "365",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const p of data) {
        expect(p.name.toLowerCase()).toContain("365");
      }
    });

    it("filters search by vendor", async () => {
      const result = await runCliExpectSuccess([
        "products",
        "search",
        "backup",
        "--vendor",
        "Acronis",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const p of data) {
        expect(p.name.toLowerCase()).toContain("backup");
      }
    });

    it("shows empty state for no results", async () => {
      const result = await runCli([
        "products",
        "search",
        "nonexistent-product-xyz",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toEqual([]);
    });
  });

  describe("products --help", () => {
    it("shows products subcommands", async () => {
      const result = await runCliExpectSuccess(["products", "--help"]);
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("show");
      expect(result.stdout).toContain("search");
    });
  });
});
