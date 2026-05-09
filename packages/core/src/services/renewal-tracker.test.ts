// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { getUpcomingRenewals } from "./renewal-tracker.js";

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function makeSub(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    companyId: "co-1",
    companyName: "Acme Corp",
    productName: "Microsoft 365",
    quantity: 10,
    price: 12.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: daysFromNow(15),
    ...overrides,
  };
}

describe("getUpcomingRenewals", () => {
  it("should return subscriptions within the specified days window", () => {
    const subs = [
      makeSub({ id: "s1", commitmentTermEndDate: daysFromNow(5) }),
      makeSub({ id: "s2", commitmentTermEndDate: daysFromNow(15) }),
      makeSub({ id: "s3", commitmentTermEndDate: daysFromNow(25) }),
      makeSub({ id: "s4", commitmentTermEndDate: daysFromNow(35) }),
    ];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items).toHaveLength(3);
    expect(report.items.map((i) => i.subscriptionId)).toEqual(["s1", "s2", "s3"]);
  });

  it("should filter by 7 days", () => {
    const subs = [
      makeSub({ id: "s1", commitmentTermEndDate: daysFromNow(3) }),
      makeSub({ id: "s2", commitmentTermEndDate: daysFromNow(10) }),
    ];

    const report = getUpcomingRenewals(subs, 7);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].subscriptionId).toBe("s1");
  });

  it("should filter by 14 days", () => {
    const subs = [
      makeSub({ id: "s1", commitmentTermEndDate: daysFromNow(7) }),
      makeSub({ id: "s2", commitmentTermEndDate: daysFromNow(14) }),
      makeSub({ id: "s3", commitmentTermEndDate: daysFromNow(20) }),
    ];

    const report = getUpcomingRenewals(subs, 14);
    expect(report.items).toHaveLength(2);
  });

  it("should sort by urgency (soonest first)", () => {
    const subs = [
      makeSub({ id: "s1", commitmentTermEndDate: daysFromNow(20) }),
      makeSub({ id: "s2", commitmentTermEndDate: daysFromNow(5) }),
      makeSub({ id: "s3", commitmentTermEndDate: daysFromNow(10) }),
    ];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items[0].subscriptionId).toBe("s2");
    expect(report.items[1].subscriptionId).toBe("s3");
    expect(report.items[2].subscriptionId).toBe("s1");
  });

  it("should count annual vs monthly subscriptions", () => {
    const subs = [
      makeSub({ id: "s1", billingTerm: "Monthly", commitmentTermEndDate: daysFromNow(5) }),
      makeSub({ id: "s2", billingTerm: "Annual", commitmentTermEndDate: daysFromNow(10) }),
      makeSub({ id: "s3", billingTerm: "Yearly", commitmentTermEndDate: daysFromNow(12) }),
    ];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.annualCount).toBe(2);
    expect(report.monthlyCount).toBe(1);
  });

  it("should compute MRR at risk for monthly subscriptions", () => {
    const subs = [
      makeSub({ id: "s1", price: 10, quantity: 5, billingTerm: "Monthly", commitmentTermEndDate: daysFromNow(5) }),
    ];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items[0].mrrAtRisk).toBe(50); // 10 * 5
    expect(report.totalMrrAtRisk).toBe(50);
  });

  it("should compute MRR at risk for annual subscriptions (price*qty / 12)", () => {
    const subs = [
      makeSub({ id: "s1", price: 120, quantity: 1, billingTerm: "Annual", commitmentTermEndDate: daysFromNow(5) }),
    ];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items[0].mrrAtRisk).toBe(10); // 120 * 1 / 12
  });

  it("should count urgent items (within 14 days)", () => {
    const subs = [
      makeSub({ id: "s1", commitmentTermEndDate: daysFromNow(3) }),
      makeSub({ id: "s2", commitmentTermEndDate: daysFromNow(14) }),
      makeSub({ id: "s3", commitmentTermEndDate: daysFromNow(20) }),
    ];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.urgentCount).toBe(2); // 3 days and 14 days
  });

  it("should handle renewal today (0 days)", () => {
    const subs = [makeSub({ id: "s1", commitmentTermEndDate: daysFromNow(0) })];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].daysUntilRenewal).toBe(0);
  });

  it("should handle renewal tomorrow", () => {
    const subs = [makeSub({ id: "s1", commitmentTermEndDate: daysFromNow(1) })];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].daysUntilRenewal).toBe(1);
  });

  it("should exclude past renewals", () => {
    const subs = [makeSub({ id: "s1", commitmentTermEndDate: daysFromNow(-1) })];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items).toHaveLength(0);
  });

  it("should handle subscriptions with no end date", () => {
    const subs = [{ id: "s1", companyId: "co-1", productName: "Test", quantity: 1, price: 10 }];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items).toHaveLength(0);
  });

  it("should handle nested commitmentTerm.endDate", () => {
    const subs = [
      {
        id: "s1",
        companyId: "co-1",
        companyName: "Test Co",
        productName: "Test",
        quantity: 5,
        price: 10,
        commitmentTerm: { endDate: daysFromNow(7), billingTerm: "Monthly" },
      },
    ];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].daysUntilRenewal).toBe(7);
  });

  it("should handle empty subscriptions list", () => {
    const report = getUpcomingRenewals([], 30);
    expect(report.items).toHaveLength(0);
    expect(report.totalMrrAtRisk).toBe(0);
    expect(report.annualCount).toBe(0);
    expect(report.monthlyCount).toBe(0);
    expect(report.urgentCount).toBe(0);
  });

  // --- Edge case tests ---

  it("should return empty report when all subscriptions have no commitmentTermEndDate", () => {
    const subs = [
      { id: "s1", companyId: "co-1", productName: "M365", quantity: 10, price: 10 },
      { id: "s2", companyId: "co-2", productName: "Teams", quantity: 5, price: 20 },
      { id: "s3", companyId: "co-3", productName: "Exchange", quantity: 3, price: 15 },
    ];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items).toHaveLength(0);
    expect(report.totalMrrAtRisk).toBe(0);
  });

  it("should not include subscriptions with commitmentTermEndDate in the past", () => {
    const subs = [
      makeSub({ id: "s1", commitmentTermEndDate: daysFromNow(-10) }),
      makeSub({ id: "s2", commitmentTermEndDate: daysFromNow(-1) }),
      makeSub({ id: "s3", commitmentTermEndDate: daysFromNow(-100) }),
    ];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items).toHaveLength(0);
  });

  it("should handle withinDays = 0 (only renewals today)", () => {
    const subs = [
      makeSub({ id: "s1", commitmentTermEndDate: daysFromNow(0) }),
      makeSub({ id: "s2", commitmentTermEndDate: daysFromNow(1) }),
    ];

    const report = getUpcomingRenewals(subs, 0);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].subscriptionId).toBe("s1");
    expect(report.items[0].daysUntilRenewal).toBe(0);
  });

  it("should handle very large withinDays (365+)", () => {
    const subs = [
      makeSub({ id: "s1", commitmentTermEndDate: daysFromNow(100) }),
      makeSub({ id: "s2", commitmentTermEndDate: daysFromNow(200) }),
      makeSub({ id: "s3", commitmentTermEndDate: daysFromNow(364) }),
      makeSub({ id: "s4", commitmentTermEndDate: daysFromNow(400) }),
    ];

    const report = getUpcomingRenewals(subs, 365);
    expect(report.items).toHaveLength(3);
    expect(report.items.map((i) => i.subscriptionId)).toEqual(["s1", "s2", "s3"]);
  });

  it("should include subscription with price = 0 but with 0 MRR", () => {
    const subs = [
      makeSub({ id: "s1", price: 0, quantity: 10, commitmentTermEndDate: daysFromNow(5) }),
    ];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].mrrAtRisk).toBe(0);
    expect(report.totalMrrAtRisk).toBe(0);
  });

  // ─── ARR companion field (#295) ────────────────────────────────────────────
  // ARR is the derived board/investor metric — PFR-86 escalations frame risk
  // as "$12M ARR partner" — while MRR stays the canonical operational unit.
  // Pax8 internal convention is `÷ 12` annual amortization for MRR, so ARR =
  // MRR × 12 falls out cleanly.
  it("should compute arrAtRisk = mrrAtRisk * 12 for monthly subscriptions", () => {
    const subs = [
      makeSub({ id: "s1", price: 10, quantity: 5, billingTerm: "Monthly", commitmentTermEndDate: daysFromNow(5) }),
    ];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items[0].mrrAtRisk).toBe(50);
    expect(report.items[0].arrAtRisk).toBe(600); // 50 * 12
  });

  it("should compute arrAtRisk = mrrAtRisk * 12 for annual subscriptions", () => {
    // Annual contracts get amortized to MRR via `÷ 12`, then ARR is MRR × 12 —
    // so ARR equals annual contract value (price × qty) in this case.
    const subs = [
      makeSub({ id: "s1", price: 120, quantity: 1, billingTerm: "Annual", commitmentTermEndDate: daysFromNow(5) }),
    ];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.items[0].mrrAtRisk).toBe(10);
    expect(report.items[0].arrAtRisk).toBe(120);
  });

  it("should compute totalArrAtRisk = totalMrrAtRisk * 12 across mixed billing terms", () => {
    const subs = [
      makeSub({ id: "s1", price: 10, quantity: 5, billingTerm: "Monthly", commitmentTermEndDate: daysFromNow(5) }), // MRR 50
      makeSub({ id: "s2", price: 120, quantity: 1, billingTerm: "Annual", commitmentTermEndDate: daysFromNow(7) }), // MRR 10
    ];

    const report = getUpcomingRenewals(subs, 30);
    expect(report.totalMrrAtRisk).toBe(60);
    expect(report.totalArrAtRisk).toBe(720); // 60 * 12
  });

  it("arrAtRisk equals mrrAtRisk * 12 for every item in a real-shaped report", () => {
    const subs = [
      makeSub({ id: "s1", price: 10, quantity: 5, billingTerm: "Monthly", commitmentTermEndDate: daysFromNow(2) }),
      makeSub({ id: "s2", price: 120, quantity: 1, billingTerm: "Annual", commitmentTermEndDate: daysFromNow(7) }),
      makeSub({ id: "s3", price: 0, quantity: 10, billingTerm: "Monthly", commitmentTermEndDate: daysFromNow(10) }),
    ];

    const report = getUpcomingRenewals(subs, 30);
    for (const item of report.items) {
      expect(item.arrAtRisk).toBe(item.mrrAtRisk * 12);
    }
  });
});
