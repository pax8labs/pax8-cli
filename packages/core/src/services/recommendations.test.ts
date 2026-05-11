// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { findUpsellCohort, getRecommendations } from "./recommendations.js";

function makeSub(overrides: Record<string, unknown> = {}) {
  return {
    companyId: "company-1",
    companyName: "Acme Corp",
    productId: "prod-m365",
    productName: "Microsoft 365 Business Premium [New Commerce Experience]",
    quantity: 50,
    price: 22,
    status: "Active",
    billingTerm: "Monthly",
    ...overrides,
  };
}

describe("getRecommendations", () => {
  it("flags missing backup for a company with productivity", () => {
    const subs = [makeSub()]; // has productivity, no backup
    const report = getRecommendations(subs);
    const backup = report.recommendations.find((r) => r.title.toLowerCase().includes("backup"));
    expect(backup).toBeDefined();
    expect(backup!.type).toBe("cross_sell");
    expect(backup!.companyId).toBe("company-1");
  });

  it("does NOT flag backup if company already has it", () => {
    const subs = [
      makeSub(),
      makeSub({ productId: "prod-backup", productName: "AvePoint Cloud Backup for Microsoft 365", price: 8 }),
    ];
    const report = getRecommendations(subs);
    const backup = report.recommendations.filter((r) => r.title.toLowerCase().includes("backup") && r.type === "cross_sell");
    expect(backup.length).toBe(0);
  });

  it("estimates MRR uplift from subscription prices", () => {
    const subs = [
      makeSub({ companyId: "c1", companyName: "Needs Identity", quantity: 50, price: 22 }),
      // Another company HAS identity — provides peer product and price
      makeSub({ companyId: "c2", companyName: "Has Identity", quantity: 10, price: 22 }),
      makeSub({ companyId: "c2", companyName: "Has Identity", productId: "prod-aad", productName: "Microsoft Entra ID P1 [New Commerce Experience]", quantity: 10, price: 6 }),
    ];
    const report = getRecommendations(subs);
    const identityRec = report.recommendations.find(
      (r) => r.companyId === "c1" && r.title.toLowerCase().includes("entra id")
    );
    expect(identityRec).toBeDefined();
    expect(identityRec!.estimatedMrrUplift).toBeGreaterThan(0);
    // 50 seats * $6/seat = $300
    expect(identityRec!.estimatedMrrUplift).toBe(300);
  });

  it("uses peer products from other companies for cross-sell", () => {
    const subs = [
      makeSub({ companyId: "c1", companyName: "Needs Backup" }),
      makeSub({ companyId: "c2", companyName: "Has Backup" }),
      makeSub({ companyId: "c2", companyName: "Has Backup", productId: "prod-bk", productName: "Datto SaaS Protection", price: 5 }),
    ];
    const report = getRecommendations(subs);
    const rec = report.recommendations.find(
      (r) => r.companyId === "c1" && r.title.includes("Datto")
    );
    expect(rec).toBeDefined();
    expect(rec!.orderCommand).toContain("prod-bk");
    expect(rec!.productAvailable).toBe(true);
  });

  it("filters restricted SKUs from peer matching", () => {
    const subs = [
      makeSub({ companyId: "c1", companyName: "Needs Identity" }),
      makeSub({ companyId: "c2", companyName: "Has NonProfit Identity" }),
      makeSub({
        companyId: "c2", companyName: "Has NonProfit Identity",
        productId: "prod-np", productName: "Azure AD P1 (Non-Profit Pricing)", price: 2,
      }),
    ];
    const report = getRecommendations(subs);
    const rec = report.recommendations.find(
      (r) => r.companyId === "c1" && r.title.includes("Non-Profit")
    );
    // Should NOT recommend the non-profit product
    expect(rec).toBeUndefined();
  });

  it("marks recs without orderable product as productAvailable: false", () => {
    const subs = [makeSub()]; // no peer backup products exist
    const report = getRecommendations(subs);
    const backup = report.recommendations.find((r) => r.title.toLowerCase().includes("backup"));
    expect(backup).toBeDefined();
    expect(backup!.productAvailable).toBe(false);
    expect(backup!.orderCommand).toBeNull();
  });

  it("detects seat gaps within same category", () => {
    const subs = [
      makeSub({ productId: "p1", productName: "Microsoft 365 E3 [New Commerce Experience]", quantity: 100, price: 36 }),
      makeSub({ productId: "p2", productName: "Microsoft 365 E5 [New Commerce Experience]", quantity: 20, price: 57 }),
    ];
    const report = getRecommendations(subs);
    const gap = report.recommendations.find((r) => r.type === "seat_gap");
    expect(gap).toBeDefined();
    expect(gap!.targetSeats).toBe(80); // 100 - 20
  });

  it("rounds MRR values to 2 decimal places", () => {
    // Use a price that causes floating-point issues: 22.99 * 3 / 12 = 5.7475
    const subs = [
      makeSub({ price: 22.99, quantity: 3, billingTerm: "Annual" }),
    ];
    const report = getRecommendations(subs);
    for (const rec of report.recommendations) {
      if (rec.currentMrr != null) {
        const decimals = String(rec.currentMrr).split(".")[1] ?? "";
        expect(decimals.length).toBeLessThanOrEqual(2);
      }
      if (rec.estimatedMrrUplift != null) {
        const decimals = String(rec.estimatedMrrUplift).split(".")[1] ?? "";
        expect(decimals.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it("deduplicates recommendations", () => {
    const subs = [makeSub()];
    const report = getRecommendations(subs);
    // Same company + same title should not appear twice
    const titles = report.recommendations.map((r) => `${r.companyId}:${r.title}`);
    const uniqueTitles = new Set(titles);
    expect(titles.length).toBe(uniqueTitles.size);
  });

  it("flags companies with zero active subscriptions", () => {
    const subs = [makeSub({ companyId: "c1", companyName: "Active Co" })];
    const companies = [
      { id: "c1", name: "Active Co" },
      { id: "c2", name: "Ghost Co" },
    ];
    const report = getRecommendations(subs, undefined, companies);
    const zeroSub = report.recommendations.find(
      (r) => r.companyId === "c2" && r.title.includes("No active subscriptions")
    );
    expect(zeroSub).toBeDefined();
    expect(zeroSub!.type).toBe("cross_sell");
    // Per the additive `opportunityType` axis (OE canon: 5 types), a
    // zero-active-sub company is Net-new — there is no existing stack to
    // cross-sell into. The legacy `type` stays `cross_sell` for one cycle;
    // the full migration is deferred to v0.2 (#375).
    expect(zeroSub!.opportunityType).toBe("Net-new");
    expect(zeroSub!.priority).toBe("high");
    expect(zeroSub!.companyName).toBe("Ghost Co");
    expect(zeroSub!.reason).toContain("no active subscriptions");
    expect(zeroSub!.suggestedProducts).toEqual([]);
    expect(zeroSub!.orderCommand).toBeNull();
    expect(zeroSub!.productAvailable).toBe(false);
    expect(zeroSub!.currentMrr).toBe(0);
    expect(zeroSub!.estimatedMrrUplift).toBeNull();
    expect(zeroSub!.targetSeats).toBeNull();
    expect(zeroSub!.estimateType).toBe("upper_bound");
  });

  it("does NOT flag zero-sub companies when companies param is omitted", () => {
    const subs = [makeSub({ companyId: "c1", companyName: "Active Co" })];
    const report = getRecommendations(subs);
    const zeroSub = report.recommendations.find(
      (r) => r.title.includes("No active subscriptions")
    );
    expect(zeroSub).toBeUndefined();
  });

  it("includes zero-sub companies in totalCompanies count", () => {
    const subs = [makeSub({ companyId: "c1", companyName: "Active Co" })];
    const companies = [
      { id: "c1", name: "Active Co" },
      { id: "c2", name: "Ghost Co" },
      { id: "c3", name: "Another Ghost" },
    ];
    const report = getRecommendations(subs, undefined, companies);
    expect(report.totalCompanies).toBe(3);
  });

  it("populates opportunityType on every recommendation per the OE 5-type taxonomy", () => {
    // Build a portfolio that exercises all three emission paths:
    //   - cross-sell rule (active subs, missing category)  → "Cross-sell"
    //   - seat-gap heuristic (same-category seat mismatch) → "Upsell"
    //   - zero-sub company                                  → "Net-new"
    const subs = [
      // Big M365 sub creates the productivity stack — triggers cross-sell rules.
      makeSub({ companyId: "c1", companyName: "Has Productivity", quantity: 100, price: 22 }),
      // Smaller same-category sub on the SAME company creates a seat-gap.
      makeSub({
        companyId: "c1", companyName: "Has Productivity",
        productId: "p2", productName: "Microsoft 365 Business Basic [New Commerce Experience]",
        quantity: 20, price: 6,
      }),
    ];
    const companies = [
      { id: "c1", name: "Has Productivity" },
      { id: "c2", name: "Ghost Co" }, // zero-sub
    ];
    const report = getRecommendations(subs, undefined, companies);

    // Every rec must carry an opportunityType drawn from the OE 5-type set.
    const allowed = new Set(["Upsell", "Cross-sell", "Add-on", "Upgrade", "Net-new"]);
    for (const rec of report.recommendations) {
      expect(allowed.has(rec.opportunityType)).toBe(true);
    }

    // Mapping invariants per the doc-comment at the top of recommendations.ts:
    //   cross_sell + has active subs    → Cross-sell
    //   cross_sell + zero active subs   → Net-new
    //   seat_gap                         → Upsell
    for (const rec of report.recommendations) {
      if (rec.type === "seat_gap") {
        expect(rec.opportunityType).toBe("Upsell");
      } else if (rec.type === "cross_sell" && rec.companyId === "c2") {
        expect(rec.opportunityType).toBe("Net-new");
      } else if (rec.type === "cross_sell") {
        expect(rec.opportunityType).toBe("Cross-sell");
      }
    }

    // Sanity: at least one of each path actually fired.
    expect(report.recommendations.some((r) => r.opportunityType === "Cross-sell")).toBe(true);
    expect(report.recommendations.some((r) => r.opportunityType === "Net-new")).toBe(true);
    expect(report.recommendations.some((r) => r.opportunityType === "Upsell")).toBe(true);
  });
});

describe("findUpsellCohort", () => {
  function sub(overrides: Record<string, unknown>) {
    return {
      productId: "prod-x",
      productName: "Microsoft 365 Business Basic [New Commerce Experience]",
      quantity: 10,
      price: 6,
      status: "Active",
      billingTerm: "Monthly",
      ...overrides,
    };
  }

  it("returns companies on from-product who lack to-product", () => {
    const subs = [
      // Wants: on Basic, not on Premium.
      sub({ companyId: "c1", companyName: "Basic Only", quantity: 25, price: 6 }),
      // Excluded: already on Premium.
      sub({ companyId: "c2", companyName: "Already Upgraded", quantity: 50, price: 6 }),
      sub({
        companyId: "c2", companyName: "Already Upgraded",
        productId: "prod-prem", productName: "Microsoft 365 Business Premium [New Commerce Experience]",
        quantity: 50, price: 22,
      }),
      // Excluded: doesn't have the source product at all.
      sub({
        companyId: "c3", companyName: "Different Stack",
        productId: "prod-other", productName: "Datto SaaS Protection",
        quantity: 10, price: 5,
      }),
    ];
    const report = findUpsellCohort(
      subs,
      "Microsoft 365 Business Basic",
      "Microsoft 365 Business Premium",
    );
    expect(report.matches.length).toBe(1);
    expect(report.matches[0].companyId).toBe("c1");
    expect(report.matches[0].companyName).toBe("Basic Only");
    expect(report.matches[0].fromSeats).toBe(25);
    // 25 seats * $6 = $150/mo
    expect(report.matches[0].fromMrr).toBe(150);
    expect(report.matches[0].opportunityType).toBe("Upsell");
    expect(report.alreadyHaveToProduct).toBe(1);
    expect(report.totalFromProductCompanies).toBe(2);
    expect(report.fromProduct).toBe("Microsoft 365 Business Basic");
    expect(report.toProduct).toBe("Microsoft 365 Business Premium");
  });

  it("returns empty matches when no company has the from-product (edge: empty cohort)", () => {
    const subs = [
      sub({
        companyId: "c1", companyName: "Only Other",
        productId: "prod-other", productName: "Datto SaaS Protection",
      }),
    ];
    const report = findUpsellCohort(subs, "Microsoft 365 Business Basic", "Microsoft 365 Business Premium");
    expect(report.matches).toEqual([]);
    expect(report.totalFromProductCompanies).toBe(0);
    expect(report.alreadyHaveToProduct).toBe(0);
  });

  it("returns empty matches when every from-product company already has to-product (edge: fully upgraded)", () => {
    const subs = [
      sub({ companyId: "c1", companyName: "Co A" }),
      sub({
        companyId: "c1", companyName: "Co A",
        productId: "prod-prem", productName: "Microsoft 365 Business Premium [New Commerce Experience]",
        quantity: 10, price: 22,
      }),
      sub({ companyId: "c2", companyName: "Co B" }),
      sub({
        companyId: "c2", companyName: "Co B",
        productId: "prod-prem", productName: "Microsoft 365 Business Premium [New Commerce Experience]",
        quantity: 10, price: 22,
      }),
    ];
    const report = findUpsellCohort(subs, "Microsoft 365 Business Basic", "Microsoft 365 Business Premium");
    expect(report.matches).toEqual([]);
    expect(report.totalFromProductCompanies).toBe(2);
    expect(report.alreadyHaveToProduct).toBe(2);
  });

  it("attaches contact details when contacts are provided", () => {
    const subs = [sub({ companyId: "c1", companyName: "Basic Only", quantity: 10, price: 6 })];
    const report = findUpsellCohort(
      subs,
      "Microsoft 365 Business Basic",
      "Microsoft 365 Business Premium",
      {
        contacts: [
          { companyId: "c1", firstName: "Pat", lastName: "Lee", email: "pat@basic.example" },
          { companyId: "c1", firstName: "Sam", lastName: "Lee", email: "sam@basic.example" },
          // Different company — should not leak into c1's contact list.
          { companyId: "other", email: "ghost@other.example" },
        ],
      },
    );
    expect(report.matches.length).toBe(1);
    expect(report.matches[0].contacts).toEqual([
      { name: "Pat Lee", email: "pat@basic.example" },
      { name: "Sam Lee", email: "sam@basic.example" },
    ]);
  });

  it("matches by partial product name (token-based)", () => {
    const subs = [sub({ companyId: "c1", companyName: "Basic Only" })];
    // Query with a partial name like "Business Basic" should still match
    // "Microsoft 365 Business Basic [New Commerce Experience]".
    const report = findUpsellCohort(subs, "Business Basic", "Business Premium");
    expect(report.matches.length).toBe(1);
    expect(report.matches[0].companyId).toBe("c1");
  });
});
