import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("pax8 report", () => {
  describe("report mrr", () => {
    it("returns valid JSON with totalMrr, projectedArr, and companies array", async () => {
      const result = await runCliExpectSuccess(["report", "mrr", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("totalMrr");
      expect(data).toHaveProperty("projectedArr");
      expect(data).toHaveProperty("companies");
      expect(typeof data.totalMrr).toBe("number");
      expect(typeof data.projectedArr).toBe("number");
      expect(Array.isArray(data.companies)).toBe(true);
      expect(data.companies.length).toBeGreaterThan(0);
    });

    it("each company has name, activeSubs, mrr, pctOfTotal", async () => {
      const result = await runCliExpectSuccess(["report", "mrr", "--json"]);
      const data = JSON.parse(result.stdout);
      for (const company of data.companies) {
        expect(company).toHaveProperty("name");
        expect(company).toHaveProperty("activeSubs");
        expect(company).toHaveProperty("mrr");
        expect(company).toHaveProperty("pctOfTotal");
        expect(typeof company.name).toBe("string");
        expect(typeof company.activeSubs).toBe("number");
        expect(typeof company.mrr).toBe("number");
        expect(typeof company.pctOfTotal).toBe("number");
      }
    });

    it("includes nextActions array", async () => {
      const result = await runCliExpectSuccess(["report", "mrr", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("nextActions");
      expect(Array.isArray(data.nextActions)).toBe(true);
      expect(data.nextActions.length).toBeGreaterThan(0);
      for (const action of data.nextActions) {
        expect(action).toHaveProperty("command");
        expect(action).toHaveProperty("description");
      }
    });
  });

  describe("report growth", () => {
    it("returns valid JSON with monthly data points", async () => {
      const result = await runCliExpectSuccess(["report", "growth", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("months");
      expect(Array.isArray(data.months)).toBe(true);
      expect(data.months.length).toBeGreaterThan(0);
      expect(data).toHaveProperty("averageGrowthPercent");
      expect(data).toHaveProperty("overallGrowthPercent");
      expect(typeof data.averageGrowthPercent).toBe("number");
      expect(typeof data.overallGrowthPercent).toBe("number");

      const month = data.months[0];
      expect(month).toHaveProperty("month");
      expect(month).toHaveProperty("mrr");
      expect(month).toHaveProperty("delta");
      expect(month).toHaveProperty("growthPercent");
    });

    it("respects the --months flag", async () => {
      const result = await runCliExpectSuccess([
        "report",
        "growth",
        "--months",
        "3",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.months.length).toBeLessThanOrEqual(3);
    });

    it("includes nextActions array with growth metrics", async () => {
      const result = await runCliExpectSuccess(["report", "growth", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("nextActions");
      expect(Array.isArray(data.nextActions)).toBe(true);
      expect(data.nextActions.length).toBeGreaterThan(0);
      for (const action of data.nextActions) {
        expect(action).toHaveProperty("command");
        expect(action).toHaveProperty("description");
      }
    });
  });
});
