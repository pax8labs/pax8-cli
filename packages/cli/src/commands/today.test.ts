// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { assembleToday, type TodayItem } from "./today.js";

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
    const urgent = Array.from({ length: 15 }, (_, i) =>
      mkItem({ summary: `renews in ${i + 1}d` }),
    );
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
    const five = (k: TodayItem["kind"]) =>
      Array.from({ length: 5 }, () => mkItem({ kind: k }));
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
