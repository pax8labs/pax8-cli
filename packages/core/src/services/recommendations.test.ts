import { describe, it, expect } from "vitest";
import { getRecommendations } from "./recommendations.js";

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
    expect(rec!.orderCommand).toContain("Datto SaaS Protection");
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
});
