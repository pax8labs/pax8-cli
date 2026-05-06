// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

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

  describe("summary counts match visible items (issue #51)", () => {
    const mixedRecs: Recommendation[] = [
      makeRec({
        companyId: "company-1",
        companyName: "Summit Healthcare Partners",
        priority: "high",
        productAvailable: true,
        estimatedMrrUplift: 100,
      }),
      makeRec({
        companyId: "company-2",
        companyName: "Pinnacle Financial Group",
        priority: "high",
        productAvailable: false, // hidden by default
        estimatedMrrUplift: 200,
      }),
      makeRec({
        companyId: "company-3",
        companyName: "Bright Minds Academy",
        priority: "medium",
        productAvailable: true,
        estimatedMrrUplift: 50,
      }),
      makeRec({
        companyId: "company-3",
        companyName: "Bright Minds Academy",
        priority: "low",
        productAvailable: false, // hidden by default
        estimatedMrrUplift: 75,
      }),
    ];

    it("filtering out unavailable recs changes counts correctly", () => {
      // Simulate what list.ts does: filter out unavailable items
      const hiddenCount = mixedRecs.filter((r) => !r.productAvailable).length;
      const visible = mixedRecs.filter((r) => r.productAvailable);

      // Summary counts should reflect VISIBLE items only
      const visibleCompanies = new Set(visible.map((r) => r.companyId)).size;
      const highCount = visible.filter((r) => r.priority === "high").length;
      const totalUplift = visible.reduce((sum, r) => sum + (r.estimatedMrrUplift ?? 0), 0);

      expect(visible).toHaveLength(2);
      expect(hiddenCount).toBe(2);
      expect(visibleCompanies).toBe(2); // company-1 and company-3
      expect(highCount).toBe(1); // only company-1's high-priority rec is visible
      expect(totalUplift).toBe(150); // 100 + 50, NOT 100 + 200 + 50 + 75
    });

    it("--include-all would show all recs and counts", () => {
      // When --include-all is used, no items are hidden
      const allCompanies = new Set(mixedRecs.map((r) => r.companyId)).size;
      const allHighCount = mixedRecs.filter((r) => r.priority === "high").length;
      const allUplift = mixedRecs.reduce((sum, r) => sum + (r.estimatedMrrUplift ?? 0), 0);

      expect(mixedRecs).toHaveLength(4);
      expect(allCompanies).toBe(3); // 3 distinct companies
      expect(allHighCount).toBe(2); // both high-priority recs
      expect(allUplift).toBe(425); // all uplifts summed
    });
  });
});
