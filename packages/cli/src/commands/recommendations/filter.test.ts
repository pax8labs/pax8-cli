import { describe, it, expect } from "vitest";
import { filterRecommendations, type RecFilterOptions } from "./filter.js";
import type { Recommendation } from "@pax8/core";

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    companyId: "company-1",
    companyName: "Summit Healthcare Partners",
    type: "cross_sell",
    priority: "high",
    title: "Add Microsoft Defender for Endpoint",
    reason: "No endpoint protection detected",
    suggestedProducts: ["Microsoft Defender for Endpoint P2"],
    orderCommand: null,
    productAvailable: true,
    currentMrr: 500,
    estimatedMrrUplift: 120,
    targetSeats: 10,
    ...overrides,
  };
}

const recs: Recommendation[] = [
  makeRec({
    companyId: "company-1",
    companyName: "Summit Healthcare Partners",
    type: "cross_sell",
    priority: "high",
    title: "Add Microsoft Defender for Endpoint",
    suggestedProducts: ["Microsoft Defender for Endpoint P2"],
  }),
  makeRec({
    companyId: "company-2",
    companyName: "[DEMO] Supernova IT",
    type: "seat_gap",
    priority: "medium",
    title: "Increase M365 seat count",
    suggestedProducts: ["Microsoft 365 Business Premium"],
  }),
  makeRec({
    companyId: "company-3",
    companyName: "Pinnacle Financial Group",
    type: "cross_sell",
    priority: "low",
    title: "Add CrowdStrike Falcon",
    suggestedProducts: ["CrowdStrike Falcon Go"],
  }),
];

describe("filterRecommendations", () => {
  it("no filters returns all recommendations", () => {
    expect(filterRecommendations(recs, {})).toEqual(recs);
  });

  describe("company filter", () => {
    it("exact company name match (case-insensitive)", () => {
      const result = filterRecommendations(recs, { company: "summit healthcare partners" });
      expect(result).toHaveLength(1);
      expect(result[0].companyName).toBe("Summit Healthcare Partners");
    });

    it("partial company name (contains)", () => {
      const result = filterRecommendations(recs, { company: "Pinnacle" });
      expect(result).toHaveLength(1);
      expect(result[0].companyName).toBe("Pinnacle Financial Group");
    });

    it("matches [DEMO] prefix company by inner name", () => {
      const result = filterRecommendations(recs, { company: "Supernova IT" });
      expect(result).toHaveLength(1);
      expect(result[0].companyName).toBe("[DEMO] Supernova IT");
    });

    it("matches by companyId", () => {
      const result = filterRecommendations(recs, { company: "company-2" });
      expect(result).toHaveLength(1);
      expect(result[0].companyId).toBe("company-2");
    });
  });

  describe("priority filter", () => {
    it("filters by high priority", () => {
      const result = filterRecommendations(recs, { priority: "high" });
      expect(result).toHaveLength(1);
      expect(result[0].priority).toBe("high");
    });

    it("filters by medium priority", () => {
      const result = filterRecommendations(recs, { priority: "medium" });
      expect(result).toHaveLength(1);
      expect(result[0].priority).toBe("medium");
    });
  });

  describe("type filter", () => {
    it("filters by cross_sell type", () => {
      const result = filterRecommendations(recs, { type: "cross_sell" });
      expect(result).toHaveLength(2);
      for (const r of result) {
        expect(r.type).toBe("cross_sell");
      }
    });

    it("filters by seat_gap type", () => {
      const result = filterRecommendations(recs, { type: "seat_gap" });
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("seat_gap");
    });
  });

  describe("product filter", () => {
    it("filters by product name in suggestedProducts", () => {
      const result = filterRecommendations(recs, { product: "Defender" });
      expect(result).toHaveLength(1);
      expect(result[0].suggestedProducts[0]).toContain("Defender");
    });

    it("filters by product name in title", () => {
      const result = filterRecommendations(recs, { product: "CrowdStrike" });
      expect(result).toHaveLength(1);
      expect(result[0].title).toContain("CrowdStrike");
    });
  });

  describe("combined filters", () => {
    it("filters by company + priority", () => {
      const result = filterRecommendations(recs, {
        company: "Summit",
        priority: "high",
      });
      expect(result).toHaveLength(1);
      expect(result[0].companyName).toBe("Summit Healthcare Partners");
      expect(result[0].priority).toBe("high");
    });

    it("filters by type + product", () => {
      const result = filterRecommendations(recs, {
        type: "cross_sell",
        product: "Defender",
      });
      expect(result).toHaveLength(1);
    });

    it("returns empty when no match across combined filters", () => {
      const result = filterRecommendations(recs, {
        company: "Summit",
        priority: "low",
      });
      expect(result).toHaveLength(0);
    });
  });
});
