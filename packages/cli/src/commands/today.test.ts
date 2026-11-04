// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { assembleToday, auditWhenInvoiced, type TodayItem } from "./today.js";

/**
 * Unit tests for the pure ranking / assembly logic in `today.ts`.
 *
 * The subprocess tests in `__tests__/today.test.ts` exercise the
 * command end-to-end against demo fixtures; this file pins the
 * cap / truncation math without spinning up the CLI.
 */

function mkItem(over: Partial<TodayItem>): TodayItem {
  return {
    kind: "renewal-urgent",
    priority: "high",
    companyName: "Acme",
    summary: "renews in 3d",
    monthlyImpact: { amount: 100, currency: "USD" },
    action: { command: "pax8 x", args: ["pax8", "x"], description: "x" },
    ...over,
  };
}

describe("assembleToday", () => {
  it("caps each section at PER_KIND_CAP=3 (one runaway category can't crowd out the others)", () => {
    // 15 urgent renewals all by themselves: per-section cap drops to 3.
    // Flat composite ends up at 3 because no other sections contribute.
    const urgent = Array.from({ length: 15 }, (_, i) => mkItem({ summary: `renews in ${i + 1}d` }));
    const out = assembleToday({
      urgentRenewals: urgent,
      upcomingRenewals: [],
      audit: [],
      growth: [],
      trials: [],
    });
    expect(out.sections.urgentRenewals.length).toBe(3);
    expect(out.flat.length).toBe(3);
    // 12 dropped by the per-section cap, plus 0 by the composite cap.
    expect(out.truncated).toBe(12);
  });

  it("caps the flat composite at 10 across sections", () => {
    // 5 sections × 3 items each = 15 visible per-section-capped items.
    // Composite cap of 10 drops the last 5.
    const five = (k: TodayItem["kind"]) => Array.from({ length: 5 }, () => mkItem({ kind: k }));
    const out = assembleToday({
      urgentRenewals: five("renewal-urgent"),
      audit: five("audit-overcharge"),
      growth: five("growth-high"),
      trials: five("trial-expiring"),
      upcomingRenewals: five("renewal-upcoming"),
    });
    expect(out.flat.length).toBe(10);
    // 5 sections × 2 dropped each (5 input → 3 after PER_KIND_CAP) = 10,
    // plus composite drops 5 more (15 capped → 10).
    expect(out.truncated).toBe(10 + 5);
    // perSectionTruncated covers ONLY the per-section drops — the human
    // render uses this so its "N more not shown" hint never counts items
    // that are still on screen.
    expect(out.perSectionTruncated).toBe(10);
  });

  it("perSectionTruncated never includes composite-capped items still rendered by sections", () => {
    // Reviewer's regression case: 5 sections × 3 = 15 visible sections.
    // Composite cap fires, dropping 5 to flat. Human render shows all 15
    // section items. perSectionTruncated must be 0 in this exact case
    // because no input section exceeded PER_KIND_CAP.
    const three = (k: TodayItem["kind"]) => Array.from({ length: 3 }, () => mkItem({ kind: k }));
    const out = assembleToday({
      urgentRenewals: three("renewal-urgent"),
      audit: three("audit-overcharge"),
      growth: three("growth-high"),
      trials: three("trial-expiring"),
      upcomingRenewals: three("renewal-upcoming"),
    });
    expect(out.perSectionTruncated).toBe(0);
    // Composite cap still drops 5 from flat (15 → 10) for JSON consumers.
    expect(out.truncated).toBe(5);
    expect(out.flat.length).toBe(10);
  });

  it("counts both per-section and composite truncation in `truncated`", () => {
    // 5 urgent (per-section cap drops 2) + 5 audit (drops 2) +
    // 5 growth (drops 2). Per-section truncation = 6. Composite
    // truncation = max(0, 9 - 10) = 0 since flat would be 9.
    const out = assembleToday({
      urgentRenewals: Array.from({ length: 5 }, () => mkItem({})),
      upcomingRenewals: [],
      audit: Array.from({ length: 5 }, () => mkItem({ kind: "audit-overcharge" })),
      growth: Array.from({ length: 5 }, () => mkItem({ kind: "growth-high" })),
      trials: [],
    });
    expect(out.truncated).toBeGreaterThanOrEqual(6);
    // The first three sections of three items each fills 9; flat has the
    // priority-ordered top 9.
    expect(out.flat.length).toBe(9);
    expect(out.flat.slice(0, 3).every((i) => i.kind === "renewal-urgent")).toBe(true);
    expect(out.flat.slice(3, 6).every((i) => i.kind === "audit-overcharge")).toBe(true);
    expect(out.flat.slice(6, 9).every((i) => i.kind === "growth-high")).toBe(true);
  });

  it("priority order: urgent renewals → audit → growth → trials → upcoming", () => {
    const out = assembleToday({
      urgentRenewals: [mkItem({})],
      upcomingRenewals: [mkItem({ kind: "renewal-upcoming" })],
      audit: [mkItem({ kind: "audit-overcharge" })],
      growth: [mkItem({ kind: "growth-high" })],
      trials: [mkItem({ kind: "trial-expiring" })],
    });
    expect(out.flat.map((i) => i.kind)).toEqual([
      "renewal-urgent",
      "audit-overcharge",
      "growth-high",
      "trial-expiring",
      "renewal-upcoming",
    ]);
  });

  it("empty input → no items, no truncation", () => {
    const out = assembleToday({
      urgentRenewals: [],
      upcomingRenewals: [],
      audit: [],
      growth: [],
      trials: [],
    });
    expect(out.flat.length).toBe(0);
    expect(out.truncated).toBe(0);
    expect(out.sections.urgentRenewals.length).toBe(0);
  });
});

/**
 * Regression guard for #705.
 *
 * A live tenant with 476 active subscriptions and zero invoices produced 681
 * "undercharge" findings and a `dollarsOnTable` of $950,640 — every active
 * subscription counted as `missing` because there were no invoice lines to
 * match against. `pax8 invoices audit` reported nothing for the same tenant in
 * the same minute; only `today` was affected, and `today` is the command agents
 * are told to lead with.
 */
describe("auditWhenInvoiced (#705)", () => {
  const sub = {
    companyId: "c1",
    companyName: "Acme",
    productId: "p1",
    productName: "Widget",
    quantity: 10,
    unitPrice: 100,
    status: "Active",
  };

  it("returns an empty report when there are no invoice items", () => {
    const report = auditWhenInvoiced([], [sub] as never);

    expect(report.discrepancies).toEqual([]);
    expect(report.itemsAudited).toBe(0);
    expect(report.totalOvercharge).toBe(0);
    expect(report.totalUndercharge).toBe(0);
    expect(report.netImpact).toBe(0);
  });

  it("does not invent findings as the subscription count grows", () => {
    // The bug scaled with the portfolio: more subscriptions, more phantom
    // money. Pin that an empty invoice set stays empty regardless.
    const many = Array.from({ length: 476 }, (_, i) => ({ ...sub, companyId: `c${i}` }));

    expect(auditWhenInvoiced([], many as never).discrepancies).toHaveLength(0);
  });

  it("still audits normally once invoice items exist", () => {
    // Guard must not suppress real findings — bill for 4 when 10 are active.
    const items = [
      {
        companyId: "c1",
        companyName: "Acme",
        productId: "p1",
        productName: "Widget",
        quantity: 4,
        unitPrice: 100,
      },
    ];
    const report = auditWhenInvoiced(items as never, [sub] as never);

    expect(report.itemsAudited).toBeGreaterThan(0);
    expect(report.discrepancies.length).toBeGreaterThan(0);
  });
});
