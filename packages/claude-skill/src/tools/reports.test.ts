// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the parent module's execCli before importing the tool under test.
// The tool reads execCli from "../index.js" (the skill entrypoint), so the
// mock path is identical to the import specifier in reports.ts.
const execCliMock = vi.fn<(args: string[]) => Promise<string>>();
vi.mock("../index.js", () => ({
  execCli: (args: string[]) => execCliMock(args),
}));

// Standardized disclaimer string — verbatim from the post-#440 / #443
// CLI surfaces and the AmountCurrency reshape. The skill payload must
// embed this string so an agent consuming this tool sees the framing.
const DISCLAIMER =
  "Numbers shown are Pax8 cost — what Pax8 charges you. For partner revenue (what you charge your customers), combine with sell-through pricing from your PSA.";

// Helper: wire the execCli mock to return a synthetic { subs, companies }
// fixture in CLI envelope shape. Order matches the parallel call in the
// tool: first the subscriptions list call, then the companies list call.
function mockCliResponses(
  subsContent: unknown[],
  companiesContent: unknown[] = [],
) {
  execCliMock.mockReset();
  execCliMock
    .mockResolvedValueOnce(JSON.stringify({ content: subsContent }))
    .mockResolvedValueOnce(JSON.stringify({ content: companiesContent }));
}

describe("pax8_report_subscriptions", () => {
  beforeEach(() => {
    execCliMock.mockReset();
  });

  it("exports the canonical name and a description that frames Pax8 cost honestly", async () => {
    const { pax8_report_subscriptions } = await import("./reports.js");
    expect(pax8_report_subscriptions.name).toBe("pax8_report_subscriptions");
    // No "MRR" / "Monthly Recurring Revenue" / "ARR" in the description —
    // the rename PR's whole point is to drop the misleading framing.
    expect(pax8_report_subscriptions.description).not.toMatch(/\bMRR\b/);
    expect(pax8_report_subscriptions.description).not.toMatch(
      /Monthly Recurring Revenue/i,
    );
    expect(pax8_report_subscriptions.description).not.toMatch(/\bARR\b/);
    // Should honestly describe what it returns.
    expect(pax8_report_subscriptions.description).toMatch(/Pax8 cost/);
    expect(pax8_report_subscriptions.description).toMatch(/AmountCurrency/);
  });

  it("returns wrapped AmountCurrency envelopes and the standardized disclaimer", async () => {
    mockCliResponses(
      [
        {
          companyId: "c1",
          companyName: "Acme",
          productId: "p1",
          productName: "Widget",
          quantity: 10,
          price: 5,
          status: "Active",
          billingTerm: "Monthly",
          currencyCode: "USD",
        },
      ],
      [{ id: "c1", name: "Acme" }],
    );

    const { pax8_report_subscriptions } = await import("./reports.js");
    const raw = await pax8_report_subscriptions.execute({});
    const parsed = JSON.parse(raw);

    // Top-level wrapped envelopes — same shape `dashboard --json` and
    // `report subscriptions --json` emit on the CLI side.
    expect(parsed.totalMonthlyCost).toEqual({ amount: 50, currency: "USD" });
    expect(parsed.totalAnnualCost).toEqual({ amount: 600, currency: "USD" });
    expect(parsed.totalActiveSubscriptions).toBe(1);
    expect(parsed.totalSeats).toBe(10);

    // Per-company array carries the same envelope, plus companyId so an
    // agent can chain to other tools by ID.
    expect(parsed.companiesByMonthlyCost).toEqual([
      {
        companyId: "c1",
        companyName: "Acme",
        monthlyCost: { amount: 50, currency: "USD" },
        subscriptionCount: 1,
        totalSeats: 10,
      },
    ]);

    // Disclaimer is a first-class field, not just a docstring — JSON
    // consumers can't see help text, so the framing must travel with
    // the payload.
    expect(parsed.disclaimer).toBe(DISCLAIMER);
  });

  it("normalizes 2-Year and 3-Year billing terms (not the pre-#439 monthly fall-through)", async () => {
    // Two subs at identical gross (price × quantity = 1000) on different
    // multi-year terms. Pre-fix bug: substring match on "annual"/"yearly"
    // let "2-Year"/"3-Year" miss the divisor and double-count.
    // Post-fix: 2-Year ÷ 24, 3-Year ÷ 36.
    mockCliResponses(
      [
        {
          companyId: "c1",
          companyName: "TwoYr Co",
          productId: "p1",
          quantity: 10,
          price: 100,
          status: "Active",
          billingTerm: "2-Year",
          currencyCode: "USD",
        },
        {
          companyId: "c2",
          companyName: "ThreeYr Co",
          productId: "p2",
          quantity: 10,
          price: 100,
          status: "Active",
          billingTerm: "3-Year",
          currencyCode: "USD",
        },
      ],
      [],
    );

    const { pax8_report_subscriptions } = await import("./reports.js");
    const raw = await pax8_report_subscriptions.execute({});
    const parsed = JSON.parse(raw);

    // 2-Year: 1000 / 24 = 41.666… → rounded to 41.67
    // 3-Year: 1000 / 36 = 27.777… → rounded to 27.78
    const c1 = parsed.companiesByMonthlyCost.find(
      (c: { companyId: string }) => c.companyId === "c1",
    );
    const c2 = parsed.companiesByMonthlyCost.find(
      (c: { companyId: string }) => c.companyId === "c2",
    );
    expect(c1.monthlyCost.amount).toBeCloseTo(1000 / 24, 2);
    expect(c2.monthlyCost.amount).toBeCloseTo(1000 / 36, 2);

    // Sanity: total monthly cost ≈ 41.67 + 27.78 ≈ 69.44 — NOT 2000 (the
    // pre-fix bug would have summed gross × 2 = 2000).
    expect(parsed.totalMonthlyCost.amount).toBeCloseTo(1000 / 24 + 1000 / 36, 2);
    expect(parsed.totalMonthlyCost.amount).toBeLessThan(100);
  });

  it("uses the first active subscription's currencyCode for the portfolio envelope", async () => {
    mockCliResponses(
      [
        {
          companyId: "c1",
          quantity: 1,
          price: 10,
          status: "Active",
          billingTerm: "Monthly",
          currencyCode: "EUR",
        },
      ],
      [],
    );
    const { pax8_report_subscriptions } = await import("./reports.js");
    const raw = await pax8_report_subscriptions.execute({});
    const parsed = JSON.parse(raw);
    expect(parsed.totalMonthlyCost.currency).toBe("EUR");
  });

  it("defaults to USD when no active subscription carries a currencyCode", async () => {
    mockCliResponses(
      [
        {
          companyId: "c1",
          quantity: 1,
          price: 10,
          status: "Active",
          billingTerm: "Monthly",
        },
      ],
      [],
    );
    const { pax8_report_subscriptions } = await import("./reports.js");
    const raw = await pax8_report_subscriptions.execute({});
    const parsed = JSON.parse(raw);
    expect(parsed.totalMonthlyCost.currency).toBe("USD");
  });
});
