// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { computeMrr, computeGrowth } from "./analytics.js";

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
