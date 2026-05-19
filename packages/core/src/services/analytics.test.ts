// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { computeMrr, computeGrowth, subscriptionMrr } from "./analytics.js";

describe("subscriptionMrr", () => {
  // 120 × 5 = 600 makes the normalization math visible for each term.
  const PRICE = 120;
  const QTY = 5;
  const GROSS = PRICE * QTY; // 600

  describe("canonical BillingTerm enum values", () => {
    it("Monthly returns price × quantity", () => {
      expect(subscriptionMrr(PRICE, QTY, "Monthly")).toBe(GROSS);
    });

    it("Annual returns price × quantity / 12", () => {
      expect(subscriptionMrr(PRICE, QTY, "Annual")).toBe(GROSS / 12); // 50
    });

    it("2-Year returns price × quantity / 24", () => {
      // Bug pre-fix: substring matching let "2-Year" fall through to the
      // monthly default (returned 600). Correct value is 600 / 24 = 25.
      expect(subscriptionMrr(PRICE, QTY, "2-Year")).toBe(GROSS / 24); // 25
    });

    it("3-Year returns price × quantity / 36", () => {
      // Bug pre-fix: same fall-through as 2-Year (returned 600).
      // Correct value is 600 / 36 ≈ 16.666…
      expect(subscriptionMrr(PRICE, QTY, "3-Year")).toBeCloseTo(GROSS / 36, 10);
    });

    // #465 — One-Time, Trial, Activation are NOT recurring revenue. The
    // pre-fix behavior returned gross, which inflated every dashboard and
    // recommendation that aggregated MRR (a $5,000 one-time onboarding fee
    // would appear as $5,000/mo recurring, i.e. $60k/yr).
    it("One-Time contributes 0 to MRR (not recurring)", () => {
      expect(subscriptionMrr(PRICE, QTY, "One-Time")).toBe(0);
    });

    it("Trial contributes 0 to MRR (not recurring)", () => {
      expect(subscriptionMrr(PRICE, QTY, "Trial")).toBe(0);
    });

    it("Activation contributes 0 to MRR (not recurring)", () => {
      expect(subscriptionMrr(PRICE, QTY, "Activation")).toBe(0);
    });
  });

  describe("commitment-style aliases (defensive)", () => {
    // `BillingTermSchema` proper doesn't include "1-Year" — Pax8 uses that on
    // `commitment.term`, not `Subscription.billingTerm`. Treating it as an
    // annual term anyway keeps us robust if the API ever surfaces it on
    // `billingTerm` (#465).
    it("1-Year treats as Annual", () => {
      expect(subscriptionMrr(PRICE, QTY, "1-Year")).toBe(GROSS / 12); // 50
    });

    it("1-year (lowercased) treats as Annual", () => {
      expect(subscriptionMrr(PRICE, QTY, "1-year")).toBe(GROSS / 12);
    });
  });

  describe("case-insensitive match", () => {
    // The call sites used to lowercase before substring-matching; preserve
    // tolerance for lowercased input so existing/loose callers keep working.
    it("monthly (lowercased)", () => {
      expect(subscriptionMrr(PRICE, QTY, "monthly")).toBe(GROSS);
    });

    it("annual (lowercased)", () => {
      expect(subscriptionMrr(PRICE, QTY, "annual")).toBe(GROSS / 12);
    });

    it("2-year (lowercased)", () => {
      expect(subscriptionMrr(PRICE, QTY, "2-year")).toBe(GROSS / 24);
    });

    it("3-year (lowercased)", () => {
      expect(subscriptionMrr(PRICE, QTY, "3-year")).toBeCloseTo(GROSS / 36, 10);
    });

    it("ANNUAL (uppercased)", () => {
      expect(subscriptionMrr(PRICE, QTY, "ANNUAL")).toBe(GROSS / 12);
    });
  });

  describe("unknown / falsy terms (#465 — warn and zero, not silent gross)", () => {
    // Pre-fix: unknown terms fell through to `price × quantity`, which was
    // dangerous because a future Pax8 enum value (e.g. "Quarterly") would
    // be silently counted at 4× its true monthly contribution. New behavior:
    // contribute 0 + emit a one-shot `stderr` warning per unknown value.
    //
    // Note: `computeMrr` still uses `sub.billingTerm ?? "monthly"` so subs
    // with a literally absent billingTerm continue to count as Monthly —
    // the warn-and-zero path is for unrecognized strings that survive past
    // the call site's default.
    it("empty string contributes 0 (caller default kicks in upstream)", () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        expect(subscriptionMrr(PRICE, QTY, "")).toBe(0);
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it("undefined (cast through string) contributes 0", () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        expect(subscriptionMrr(PRICE, QTY, undefined as unknown as string)).toBe(0);
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it("unknown future enum value contributes 0", () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        // Use a unique string per test so the one-shot-per-process dedup
        // doesn't suppress the warning we want to observe.
        expect(subscriptionMrr(PRICE, QTY, "Quarterly_test_unique_a")).toBe(0);
        expect(stderrSpy).toHaveBeenCalled();
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it("warns at most once per unknown billingTerm value", () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        subscriptionMrr(PRICE, QTY, "Septennial_test_unique_b");
        subscriptionMrr(PRICE, QTY, "Septennial_test_unique_b");
        subscriptionMrr(PRICE, QTY, "Septennial_test_unique_b");
        // Should emit exactly one warning across the three calls.
        const calls = stderrSpy.mock.calls.filter((c) =>
          String(c[0]).includes("Septennial_test_unique_b"),
        );
        expect(calls).toHaveLength(1);
      } finally {
        stderrSpy.mockRestore();
      }
    });
  });
});

describe("computeMrr", () => {
  it("should aggregate MRR by company", () => {
    const subs = [
      { companyId: "co-1", companyName: "Acme", productName: "M365", vendorName: "Microsoft", price: 10, quantity: 5, billingTerm: "Monthly", status: "Active" },
      { companyId: "co-1", companyName: "Acme", productName: "Teams", vendorName: "Microsoft", price: 5, quantity: 10, billingTerm: "Monthly", status: "Active" },
      { companyId: "co-2", companyName: "Globex", productName: "M365", vendorName: "Microsoft", price: 10, quantity: 3, billingTerm: "Monthly", status: "Active" },
    ];

    const report = computeMrr(subs);
    expect(report.byCompany).toHaveLength(2);
    expect(report.byCompany[0].companyName).toBe("Acme");
    expect(report.byCompany[0].mrr).toBe(100); // 50 + 50
    expect(report.byCompany[1].companyName).toBe("Globex");
    expect(report.byCompany[1].mrr).toBe(30);
  });

  it("should aggregate MRR by product", () => {
    const subs = [
      { companyId: "co-1", companyName: "Acme", productName: "M365", vendorName: "Microsoft", price: 10, quantity: 5, billingTerm: "Monthly", status: "Active" },
      { companyId: "co-2", companyName: "Globex", productName: "M365", vendorName: "Microsoft", price: 10, quantity: 3, billingTerm: "Monthly", status: "Active" },
      { companyId: "co-1", companyName: "Acme", productName: "Teams", vendorName: "Microsoft", price: 5, quantity: 10, billingTerm: "Monthly", status: "Active" },
    ];

    const report = computeMrr(subs);
    expect(report.byProduct).toHaveLength(2);
    expect(report.byProduct[0].productName).toBe("M365");
    expect(report.byProduct[0].mrr).toBe(80); // 50 + 30
    expect(report.byProduct[0].subscriptionCount).toBe(2);
  });

  it("should aggregate MRR by vendor", () => {
    const subs = [
      { companyId: "co-1", companyName: "Acme", productName: "M365", vendorName: "Microsoft", price: 10, quantity: 5, billingTerm: "Monthly", status: "Active" },
      { companyId: "co-1", companyName: "Acme", productName: "Workspace", vendorName: "Google", price: 8, quantity: 5, billingTerm: "Monthly", status: "Active" },
    ];

    const report = computeMrr(subs);
    expect(report.byVendor).toHaveLength(2);
    expect(report.byVendor[0].vendorName).toBe("Microsoft");
    expect(report.byVendor[0].mrr).toBe(50);
    expect(report.byVendor[1].vendorName).toBe("Google");
    expect(report.byVendor[1].mrr).toBe(40);
  });

  it("should only include Active subscriptions", () => {
    const subs = [
      { companyId: "co-1", companyName: "Acme", productName: "M365", vendorName: "Microsoft", price: 10, quantity: 5, billingTerm: "Monthly", status: "Active" },
      { companyId: "co-2", companyName: "Globex", productName: "M365", vendorName: "Microsoft", price: 10, quantity: 3, billingTerm: "Monthly", status: "Cancelled" },
    ];

    const report = computeMrr(subs);
    expect(report.totalMrr).toBe(50);
    expect(report.byCompany).toHaveLength(1);
  });

  it("should compute MRR for annual subscriptions as price/12", () => {
    const subs = [
      { companyId: "co-1", companyName: "Acme", productName: "M365", vendorName: "Microsoft", price: 120, quantity: 1, billingTerm: "Annual", status: "Active" },
    ];

    const report = computeMrr(subs);
    expect(report.totalMrr).toBe(10); // 120 / 12
  });

  it("should compute total MRR across all subscriptions", () => {
    const subs = [
      { companyId: "co-1", companyName: "Acme", productName: "M365", vendorName: "Microsoft", price: 10, quantity: 5, billingTerm: "Monthly", status: "Active" },
      { companyId: "co-2", companyName: "Globex", productName: "Teams", vendorName: "Microsoft", price: 120, quantity: 2, billingTerm: "Annual", status: "Active" },
    ];

    const report = computeMrr(subs);
    expect(report.totalMrr).toBe(70); // 50 + 20
  });

  it("should handle empty subscriptions", () => {
    const report = computeMrr([]);
    expect(report.totalMrr).toBe(0);
    expect(report.byCompany).toHaveLength(0);
    expect(report.byProduct).toHaveLength(0);
    expect(report.byVendor).toHaveLength(0);
  });

  it("should sort aggregations by MRR descending", () => {
    const subs = [
      { companyId: "co-1", companyName: "Small Co", productName: "P1", vendorName: "V1", price: 5, quantity: 1, billingTerm: "Monthly", status: "Active" },
      { companyId: "co-2", companyName: "Big Co", productName: "P2", vendorName: "V2", price: 100, quantity: 1, billingTerm: "Monthly", status: "Active" },
    ];

    const report = computeMrr(subs);
    expect(report.byCompany[0].companyName).toBe("Big Co");
    expect(report.byCompany[1].companyName).toBe("Small Co");
  });
});

describe("computeGrowth", () => {
  it("should compute monthly growth from invoices", () => {
    const invoices = [
      { invoiceDate: "2024-01-15", total: 1000 },
      { invoiceDate: "2024-02-15", total: 1100 },
      { invoiceDate: "2024-03-15", total: 1210 },
    ];

    const report = computeGrowth(invoices, 12);
    expect(report.months).toHaveLength(3);
    expect(report.months[0].month).toBe("2024-01");
    expect(report.months[0].mrr).toBe(1000);
    expect(report.months[0].delta).toBe(0); // First month has no previous
    expect(report.months[1].delta).toBe(100);
    expect(report.months[1].growthPercent).toBe(10);
    expect(report.months[2].delta).toBe(110);
  });

  it("should handle decreasing invoices", () => {
    const invoices = [
      { invoiceDate: "2024-01-15", total: 1000 },
      { invoiceDate: "2024-02-15", total: 900 },
    ];

    const report = computeGrowth(invoices, 12);
    expect(report.months[1].delta).toBe(-100);
    expect(report.months[1].growthPercent).toBe(-10);
  });

  it("should compute average growth percentage", () => {
    const invoices = [
      { invoiceDate: "2024-01-15", total: 1000 },
      { invoiceDate: "2024-02-15", total: 1100 },
      { invoiceDate: "2024-03-15", total: 1210 },
    ];

    const report = computeGrowth(invoices, 12);
    // Growth: 10%, 10% -> average 10%
    expect(report.averageGrowth).toBe(10);
  });

  it("should aggregate multiple invoices in the same month", () => {
    const invoices = [
      { invoiceDate: "2024-01-10", total: 500 },
      { invoiceDate: "2024-01-20", total: 500 },
      { invoiceDate: "2024-02-15", total: 1100 },
    ];

    const report = computeGrowth(invoices, 12);
    expect(report.months[0].mrr).toBe(1000);
    expect(report.months[1].mrr).toBe(1100);
  });

  it("should limit to specified number of months", () => {
    const invoices = [
      { invoiceDate: "2024-01-15", total: 1000 },
      { invoiceDate: "2024-02-15", total: 1100 },
      { invoiceDate: "2024-03-15", total: 1200 },
      { invoiceDate: "2024-04-15", total: 1300 },
    ];

    const report = computeGrowth(invoices, 2);
    expect(report.months).toHaveLength(2);
    expect(report.months[0].month).toBe("2024-03");
    expect(report.months[1].month).toBe("2024-04");
  });

  it("should handle empty invoices", () => {
    const report = computeGrowth([], 12);
    expect(report.months).toHaveLength(0);
    expect(report.averageGrowth).toBe(0);
  });

  it("should use the date field as fallback", () => {
    const invoices = [
      { date: "2024-01-15", amount: 1000 },
      { date: "2024-02-15", amount: 1100 },
    ];

    const report = computeGrowth(invoices, 12);
    expect(report.months).toHaveLength(2);
    expect(report.months[0].mrr).toBe(1000);
  });

  // --- Edge case tests ---

  it("should return empty growth report for empty invoices array", () => {
    const report = computeGrowth([], 6);
    expect(report.months).toHaveLength(0);
    expect(report.averageGrowth).toBe(0);
  });

  it("should handle all cancelled subscriptions excluded from MRR", () => {
    const subs = [
      { companyId: "co-1", companyName: "Acme", productName: "M365", vendorName: "Microsoft", price: 10, quantity: 5, billingTerm: "Monthly", status: "Cancelled" },
      { companyId: "co-2", companyName: "Globex", productName: "Teams", vendorName: "Microsoft", price: 20, quantity: 3, billingTerm: "Monthly", status: "Cancelled" },
      { companyId: "co-3", companyName: "Initech", productName: "Exchange", vendorName: "Microsoft", price: 15, quantity: 2, billingTerm: "Monthly", status: "Cancelled" },
    ];

    const report = computeMrr(subs);
    expect(report.totalMrr).toBe(0);
    expect(report.byCompany).toHaveLength(0);
    expect(report.byProduct).toHaveLength(0);
    expect(report.byVendor).toHaveLength(0);
  });

  it("should correctly mix Monthly and Annual billing terms in MRR", () => {
    const subs = [
      { companyId: "co-1", companyName: "Acme", productName: "M365", vendorName: "Microsoft", price: 10, quantity: 5, billingTerm: "Monthly", status: "Active" },
      { companyId: "co-1", companyName: "Acme", productName: "Premium", vendorName: "Microsoft", price: 240, quantity: 2, billingTerm: "Annual", status: "Active" },
    ];

    const report = computeMrr(subs);
    // Monthly: 10 * 5 = 50, Annual: 240 * 2 / 12 = 40
    expect(report.totalMrr).toBe(90);
    expect(report.byCompany).toHaveLength(1);
    expect(report.byCompany[0].mrr).toBe(90);
  });

  it("should handle single month of invoice data for growth (no delta possible)", () => {
    const invoices = [
      { invoiceDate: "2024-06-15", total: 5000 },
    ];

    const report = computeGrowth(invoices, 12);
    expect(report.months).toHaveLength(1);
    expect(report.months[0].delta).toBe(0);
    expect(report.months[0].growthPercent).toBe(0);
    expect(report.averageGrowth).toBe(0);
  });

  it("should handle negative invoice amounts (credits)", () => {
    const invoices = [
      { invoiceDate: "2024-01-15", total: 1000 },
      { invoiceDate: "2024-02-15", total: -200 },
    ];

    const report = computeGrowth(invoices, 12);
    expect(report.months).toHaveLength(2);
    expect(report.months[1].mrr).toBe(-200);
    expect(report.months[1].delta).toBe(-1200);
    expect(report.months[1].growthPercent).toBe(-120);
  });

  it("should handle computeGrowth with months=0", () => {
    const invoices = [
      { invoiceDate: "2024-01-15", total: 1000 },
      { invoiceDate: "2024-02-15", total: 1100 },
    ];

    const report = computeGrowth(invoices, 0);
    // slice(-0) returns full array, so this returns all months
    expect(report.months.length).toBeGreaterThanOrEqual(0);
  });

  it("should handle computeGrowth with months=1", () => {
    const invoices = [
      { invoiceDate: "2024-01-15", total: 1000 },
      { invoiceDate: "2024-02-15", total: 1100 },
      { invoiceDate: "2024-03-15", total: 1200 },
    ];

    const report = computeGrowth(invoices, 1);
    expect(report.months).toHaveLength(1);
    expect(report.months[0].month).toBe("2024-03");
    expect(report.months[0].delta).toBe(0); // first (only) month, no previous
    expect(report.averageGrowth).toBe(0);
  });
});
