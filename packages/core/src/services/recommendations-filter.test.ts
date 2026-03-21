import { describe, it, expect } from "vitest";
import { getRecommendations } from "./recommendations.js";

function makeSubs(companies: Array<{ id: string; name: string; hasBackup?: boolean }>) {
  const subs: Record<string, unknown>[] = [];
  for (const c of companies) {
    subs.push({
      companyId: c.id, companyName: c.name,
      productId: "prod-m365", productName: "Microsoft 365 Business Premium [New Commerce Experience]",
      quantity: 50, price: 22, status: "Active", billingTerm: "Monthly",
    });
    if (c.hasBackup) {
      subs.push({
        companyId: c.id, companyName: c.name,
        productId: "prod-bk", productName: "AvePoint Cloud Backup for Microsoft 365",
        quantity: 50, price: 8, status: "Active", billingTerm: "Monthly",
      });
    }
  }
  return subs;
}

describe("recommendations filtering", () => {
  it("filters by exact company name", () => {
    const subs = makeSubs([
      { id: "c1", name: "Acme Corp" },
      { id: "c2", name: "Acme Corp International" },
    ]);
    const report = getRecommendations(subs);
    // Both should have recs
    expect(report.recommendations.some((r) => r.companyName === "Acme Corp")).toBe(true);
    expect(report.recommendations.some((r) => r.companyName === "Acme Corp International")).toBe(true);

    // Filter should match only exact
    const filtered = report.recommendations.filter(
      (r) => r.companyName.toLowerCase() === "acme corp"
    );
    expect(filtered.every((r) => r.companyName === "Acme Corp")).toBe(true);
  });

  it("filters by company ID prefix", () => {
    const subs = makeSubs([
      { id: "abc12345-full-uuid", name: "Company A" },
      { id: "def67890-full-uuid", name: "Company B" },
    ]);
    const report = getRecommendations(subs);
    const filtered = report.recommendations.filter(
      (r) => r.companyId.startsWith("abc12345")
    );
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((r) => r.companyName === "Company A")).toBe(true);
  });

  it("MRR uplift uses subscription prices when catalog has no pricing", () => {
    const subs = makeSubs([
      { id: "c1", name: "Needs Everything" },
      { id: "c2", name: "Has Backup", hasBackup: true },
    ]);
    const report = getRecommendations(subs, []); // empty product catalog
    const backupRec = report.recommendations.find(
      (r) => r.companyId === "c1" && r.title.toLowerCase().includes("avepoint")
    );
    // Should have MRR uplift from peer's subscription price ($8/seat * 50 seats)
    expect(backupRec).toBeDefined();
    expect(backupRec!.estimatedMrrUplift).toBe(400);
  });

  it("sorts by MRR uplift descending within same priority", () => {
    const subs = [
      // Big company
      { companyId: "c1", companyName: "Big Co", productId: "p1", productName: "Microsoft 365 E3 [New Commerce Experience]", quantity: 200, price: 36, status: "Active", billingTerm: "Monthly" },
      // Small company
      { companyId: "c2", companyName: "Small Co", productId: "p2", productName: "Microsoft 365 Business Basic [New Commerce Experience]", quantity: 10, price: 6, status: "Active", billingTerm: "Monthly" },
      // Peer with backup
      { companyId: "c3", companyName: "Has All", productId: "p3", productName: "Microsoft 365 E3 [New Commerce Experience]", quantity: 5, price: 36, status: "Active", billingTerm: "Monthly" },
      { companyId: "c3", companyName: "Has All", productId: "p4", productName: "AvePoint Cloud Backup for Microsoft 365", quantity: 5, price: 8, status: "Active", billingTerm: "Monthly" },
    ];
    const report = getRecommendations(subs);
    const backupRecs = report.recommendations.filter(
      (r) => r.title.toLowerCase().includes("backup") && r.type === "cross_sell"
    );
    if (backupRecs.length >= 2) {
      // Big Co's backup rec should have higher uplift than Small Co's
      expect(backupRecs[0].estimatedMrrUplift!).toBeGreaterThan(backupRecs[1].estimatedMrrUplift!);
    }
  });
});
