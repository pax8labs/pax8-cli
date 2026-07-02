// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

describe("pax8 products", () => {
  describe("products list", () => {
    it("lists products in demo mode", async () => {
      const result = await runCliExpectSuccess(["products", "list", "--json"]);
      // #483: JSON envelope is { products, page }.
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("products");
      expect(data).toHaveProperty("page");
      expect(Array.isArray(data.products)).toBe(true);
      expect(data.products.length).toBeGreaterThan(0);
      expect(data.products[0]).toHaveProperty("name");
      expect(data.products[0]).toHaveProperty("vendorName");
      expect(data.products[0]).toHaveProperty("sku");
    });

    it("filters by vendor", async () => {
      const result = await runCliExpectSuccess([
        "products",
        "list",
        "--vendor",
        "AvePoint",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.products.length).toBeGreaterThan(0);
      for (const p of data.products) {
        expect(p.vendorName.toLowerCase()).toContain("avepoint");
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
      expect(data.products.length).toBeLessThanOrEqual(2);
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
      // `show` returns a single object, not an array (#208)
      expect(Array.isArray(data)).toBe(false);
      expect(data).toHaveProperty("name", "Microsoft 365 Business Premium [New Commerce Experience]");
      expect(data).toHaveProperty("vendorName", "Microsoft");
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
      expect(Array.isArray(data)).toBe(false);
      expect(data).toHaveProperty("pricingDetails");
      expect(data.pricingDetails.length).toBeGreaterThan(0);
      // Verify pricing plan includes billingTerm, commitmentTerm, and price fields
      const plan = data.pricingDetails[0];
      expect(plan).toHaveProperty("billingTerm");
      expect(plan).toHaveProperty("commitmentTerm");
      expect(plan).toHaveProperty("rates");
      expect(plan.rates[0]).toHaveProperty("partnerBuyRate");
      expect(plan.rates[0]).toHaveProperty("suggestedRetailPrice");
    });

    it("shows provisioning with --provisioning flag (spec-shaped array per Candidate H)", async () => {
      const result = await runCliExpectSuccess([
        "products",
        "show",
        "prod-m365-biz-prem-0001",
        "--provisioning",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(false);
      expect(data).toHaveProperty("provisioningDetails");
      // The spec shape is `ProvisioningDetail[]`, NOT the pre-fix
      // `{ productId, vendorPrerequisites, fields[] }` object. Each detail
      // carries `{ key, label?, description?, valueType?, possibleValues?,
      // values? }` per partner-endpoints.json.
      expect(Array.isArray(data.provisioningDetails)).toBe(true);
      expect(data.provisioningDetails.length).toBeGreaterThan(0);
      const first = data.provisioningDetails[0];
      expect(first).toHaveProperty("key");
      expect(first).toHaveProperty("valueType");
      expect(["Input", "Single-Value", "Multi-Value"]).toContain(first.valueType);
      // None of the hallucinated pre-fix fields should appear.
      expect(data.provisioningDetails).not.toHaveProperty("productId");
      expect(data.provisioningDetails).not.toHaveProperty("fields");
      expect(data.provisioningDetails).not.toHaveProperty("vendorPrerequisites");
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
      expect(Array.isArray(data)).toBe(false);
      expect(data).toHaveProperty("dependencies");
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
      // #483: search now emits { products, page } too.
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("products");
      expect(data).toHaveProperty("page");
      expect(data.products.length).toBeGreaterThan(0);
      for (const p of data.products) {
        expect(p.name.toLowerCase()).toContain("365");
      }
    });

    it("filters search by vendor", async () => {
      const result = await runCliExpectSuccess([
        "products",
        "search",
        "backup",
        "--vendor",
        "AvePoint",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.products.length).toBeGreaterThan(0);
      for (const p of data.products) {
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
      expect(data.products).toEqual([]);
      expect(data.page.totalElements).toBe(0);
    });

    // UXR F7 (#653): the human table doesn't expose product IDs, so the
    // "Try next" picker must not surface a raw ID either — labels use the
    // product name, and the numeric pick spawns `products show` silently.
    // (The numbered menu itself only renders under a TTY — see
    // `promptNextSteps` in lib/next-step.ts — so we assert on the "Try
    // next:" header and the no-ID contract, not the numbered rows.)
    it("table mode does not leak product IDs into the next-step affordance", async () => {
      const result = await runCli(
        ["products", "search", "microsoft"],
        { PAX8_OUTPUT_FORMAT: "table" },
      );
      const combined = result.stdout + result.stderr;
      expect(combined).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      expect(combined).not.toMatch(/pax8 products show prod-/);
      expect(combined).toContain("Try next:");
    });

    // Contract: `--json` output shape is machine-facing and byte-stable —
    // the human-surface fix above must not perturb it.
    it("--json output shape is unchanged by the picker refactor", async () => {
      const result = await runCliExpectSuccess([
        "products",
        "search",
        "microsoft",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("products");
      expect(data).toHaveProperty("page");
      // Every product still carries its id — machine consumers rely on it.
      for (const p of data.products) {
        expect(p).toHaveProperty("id");
        expect(p).toHaveProperty("name");
      }
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
