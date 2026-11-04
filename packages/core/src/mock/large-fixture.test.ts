// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

// Smoke tests for the large-portfolio fixture (#484).
//
// These don't yet wire the scale-matrix assertions for individual blockers
// (#462, #465, #472, #478, #483) — those land alongside each blocker fix.
// What we cover here are the invariants that the fixture itself promises:
// deterministic generation, correct shape, every BillingTerm value present,
// mixed currencies, hostile-named companies survive serialization.

import { describe, it, expect } from "vitest";
import { buildLargeFixture } from "./large-fixture.js";

describe("large-fixture", () => {
  it("generates the documented entity counts at default size", () => {
    const f = buildLargeFixture();
    expect(f.companies).toHaveLength(1000);
    expect(f.products).toHaveLength(100);
    expect(f.subscriptions).toHaveLength(5000);
    expect(f.orders).toHaveLength(45000);
    // Contacts: 1–3 per company, so at least 1000 and at most 3000.
    expect(f.contacts.length).toBeGreaterThanOrEqual(1000);
    expect(f.contacts.length).toBeLessThanOrEqual(3000);
  });

  it("is deterministic — same seed produces identical fixtures", () => {
    const a = buildLargeFixture({ companies: 50, products: 10, subscriptions: 100, orders: 200 });
    const b = buildLargeFixture({ companies: 50, products: 10, subscriptions: 100, orders: 200 });
    expect(a.companies.map((c) => c.id)).toEqual(b.companies.map((c) => c.id));
    expect(a.companies.map((c) => c.name)).toEqual(b.companies.map((c) => c.name));
    expect(a.orders.slice(0, 50).map((o) => o.id)).toEqual(b.orders.slice(0, 50).map((o) => o.id));
  });

  it("seeds every BillingTerm value in subscriptions", () => {
    // Smaller counts keep the test cheap but still hit the long-tail terms.
    const f = buildLargeFixture({ companies: 100, products: 20, subscriptions: 500, orders: 0 });
    const terms = new Set(f.subscriptions.map((s) => s.billingTerm));
    expect(terms).toContain("Monthly");
    expect(terms).toContain("Annual");
    expect(terms).toContain("2-Year");
    expect(terms).toContain("3-Year");
    expect(terms).toContain("One-Time");
    expect(terms).toContain("Trial");
    expect(terms).toContain("Activation");
  });

  it("includes non-USD subscriptions so currency rendering is exercised under scale", () => {
    const f = buildLargeFixture({ companies: 100, products: 20, subscriptions: 1000, orders: 0 });
    const currencies = new Set(f.subscriptions.map((s) => s.currencyCode));
    // At least USD must appear (overwhelming majority); plus at least one
    // non-USD currency. Don't pin to all four — the weighted picker could
    // miss a currency on small N runs, but with 1000 subs and 30% non-USD
    // weight at least one of EUR/GBP/CAD lands.
    expect(currencies).toContain("USD");
    expect(currencies.size).toBeGreaterThan(1);
  });

  it("includes hostile-named companies that exercise shell-meta and unicode paths", () => {
    const f = buildLargeFixture({ companies: 200, products: 10, subscriptions: 0, orders: 0 });
    const names = f.companies.map((c) => c.name);
    // Verify a sample of the hostile corpus is present. These exist to
    // catch shell-injection in `orderCommand` (#462), Unicode rendering,
    // and CSV escape failures.
    expect(names).toContain(`Acme " Quoted " Inc.`);
    expect(names).toContain(`O'Brien & Associates`);
    expect(names).toContain(`北京科技 Tech Co`);
    expect(names).toContain(`<script>alert(1)</script> Holdings`);
  });

  it("orders span 2013 to present (default range)", () => {
    const f = buildLargeFixture({ companies: 100, products: 10, subscriptions: 0, orders: 1000 });
    const dates = f.orders.map((o) => new Date(o.createdAt).getTime());
    const min = Math.min(...dates);
    const max = Math.max(...dates);
    expect(min).toBeGreaterThanOrEqual(Date.UTC(2013, 0, 1));
    // Max should be within the last day — generator uses Date.now() upper bound.
    expect(max).toBeLessThanOrEqual(Date.now() + 86_400_000);
    // And span at least a few years (sanity: not all clustered in one year).
    expect(max - min).toBeGreaterThan(365 * 86_400_000);
  });

  it("subscriptions reference companies and products that exist in the fixture", () => {
    const f = buildLargeFixture({ companies: 100, products: 20, subscriptions: 500, orders: 0 });
    const companyIds = new Set(f.companies.map((c) => c.id));
    const productIds = new Set(f.products.map((p) => p.id));
    for (const sub of f.subscriptions) {
      expect(companyIds.has(sub.companyId)).toBe(true);
      expect(productIds.has(sub.productId)).toBe(true);
    }
  });

  it("orders reference companies and product IDs that exist in the fixture", () => {
    const f = buildLargeFixture({ companies: 100, products: 20, subscriptions: 0, orders: 1000 });
    const companyIds = new Set(f.companies.map((c) => c.id));
    const productIds = new Set(f.products.map((p) => p.id));
    for (const order of f.orders.slice(0, 200)) {
      expect(companyIds.has(order.companyId)).toBe(true);
      for (const li of order.lineItems) {
        expect(productIds.has(li.productId)).toBe(true);
      }
    }
  });

  it("every company has at least one primary contact (Admin/Billing/Technical)", () => {
    const f = buildLargeFixture({ companies: 50, products: 10, subscriptions: 0, orders: 0 });
    const contactsByCompany = new Map<string, typeof f.contacts>();
    for (const c of f.contacts) {
      const list = contactsByCompany.get(c.companyId) ?? [];
      list.push(c);
      contactsByCompany.set(c.companyId, list);
    }
    for (const company of f.companies) {
      const list = contactsByCompany.get(company.id) ?? [];
      expect(list.length).toBeGreaterThanOrEqual(1);
      const primary = list.find((c) => c.types.every((t) => t.primary));
      expect(primary).toBeDefined();
    }
  });
});
