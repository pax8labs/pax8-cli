import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

describe("pax8 recommendations", () => {
  describe("recommendations list", () => {
    it("returns recommendations in JSON format", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("recommendations");
      expect(data).toHaveProperty("nextActions");
      expect(Array.isArray(data.recommendations)).toBe(true);
      expect(data.recommendations.length).toBeGreaterThan(0);
      expect(data.recommendations[0]).toHaveProperty("companyId");
      expect(data.recommendations[0]).toHaveProperty("companyName");
      expect(data.recommendations[0]).toHaveProperty("type");
      expect(data.recommendations[0]).toHaveProperty("priority");
      // nextActions should have command and description
      expect(Array.isArray(data.nextActions)).toBe(true);
      if (data.nextActions.length > 0) {
        expect(data.nextActions[0]).toHaveProperty("command");
        expect(data.nextActions[0]).toHaveProperty("description");
      }
      expect(data.nextActions.length).toBeLessThanOrEqual(5);
    });

    it("filters by exact company name", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "Bright Minds Academy", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.recommendations.length).toBeGreaterThan(0);
      for (const rec of data.recommendations) {
        expect(rec.companyName).toBe("Bright Minds Academy");
      }
    });

    it("filters by partial company name (contains match)", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "Bright", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.recommendations.length).toBeGreaterThan(0);
      for (const rec of data.recommendations) {
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
      expect(data.recommendations.length).toBeGreaterThan(0);
      for (const rec of data.recommendations) {
        expect(rec.companyName).toBe("Bright Minds Academy");
      }
    });

    it("filters by priority", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--priority", "high", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.recommendations.length).toBeGreaterThan(0);
      for (const rec of data.recommendations) {
        expect(rec.priority).toBe("high");
      }
    });

    it("returns empty result for non-existent company", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "NonExistentCorp99999", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.recommendations).toEqual([]);
      expect(data.nextActions).toEqual([]);
    });
  });
});
