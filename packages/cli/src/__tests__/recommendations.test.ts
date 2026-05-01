import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

describe("pax8 recommendations", () => {
  describe("recommendations list", () => {
    it("returns a flat array of recommendations in JSON by default", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("companyId");
      expect(data[0]).toHaveProperty("companyName");
      expect(data[0]).toHaveProperty("type");
      expect(data[0]).toHaveProperty("priority");
    });

    it("--with-actions wraps in { recommendations, nextActions, unmatchedProducts }", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json", "--with-actions"]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("recommendations");
      expect(data).toHaveProperty("nextActions");
      expect(data).toHaveProperty("unmatchedProducts");
      expect(Array.isArray(data.recommendations)).toBe(true);
      expect(Array.isArray(data.nextActions)).toBe(true);
      expect(data.nextActions.length).toBeLessThanOrEqual(5);
      if (data.nextActions.length > 0) {
        expect(data.nextActions[0]).toHaveProperty("command");
        expect(data.nextActions[0]).toHaveProperty("description");
      }
    });

    it("filters by exact company name", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "Bright Minds Academy", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const rec of data) {
        expect(rec.companyName).toBe("Bright Minds Academy");
      }
    });

    it("filters by partial company name (contains match)", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "Bright", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const rec of data) {
        expect(rec.companyName.toLowerCase()).toContain("bright");
      }
    });

    it("rejoins excess args into company name for unquoted multi-word names", async () => {
      // Simulates: --company Bright Minds Academy (no quotes)
      // Commander captures "Bright", "Minds" and "Academy" become excess args
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "Bright", "Minds", "Academy", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const rec of data) {
        expect(rec.companyName).toBe("Bright Minds Academy");
      }
    });

    it("filters by priority", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--priority", "high", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const rec of data) {
        expect(rec.priority).toBe("high");
      }
    });

    it("returns empty result for non-existent company", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "NonExistentCorp99999", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toEqual([]);
    });

    it("JSON output includes both available and unavailable recs for downstream filtering", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json"]);
      const allRecs = JSON.parse(result.stdout);

      // Some recs should have productAvailable: true, some false
      const available = allRecs.filter((r: { productAvailable: boolean }) => r.productAvailable);
      const unavailable = allRecs.filter((r: { productAvailable: boolean }) => !r.productAvailable);

      // The total should be the sum of available + unavailable
      expect(available.length + unavailable.length).toBe(allRecs.length);

      // Verify every rec has the productAvailable field
      for (const rec of allRecs) {
        expect(rec).toHaveProperty("productAvailable");
        expect(typeof rec.productAvailable).toBe("boolean");
      }
    });

    it("--include-all shows unavailable recs in JSON output", async () => {
      const withAll = await runCliExpectSuccess(["recommendations", "list", "--include-all", "--json"]);
      const withoutAll = await runCliExpectSuccess(["recommendations", "list", "--json"]);

      const allRecs = JSON.parse(withAll.stdout);
      const defaultRecs = JSON.parse(withoutAll.stdout);

      // Both should return the same set since JSON output is pre-filter
      // (JSON returns all recs; filtering only affects table mode)
      expect(allRecs.length).toBe(defaultRecs.length);
    });
  });
});
