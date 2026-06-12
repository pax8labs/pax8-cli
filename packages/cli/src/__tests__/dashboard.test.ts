// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("pax8 dashboard (canonical)", () => {
  it("--json returns the portfolio snapshot with wrapped AmountCurrency envelopes", async () => {
    const result = await runCliExpectSuccess(["dashboard", "--json"]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("totalCompanies");
    expect(data).toHaveProperty("activeSubscriptions");
    // Pax8-cost figures use the canonical wrapped AmountCurrency shape
    // ({ amount, currency }) — same envelope the v2 quoting API emits.
    expect(data).toHaveProperty("monthlyCost");
    expect(data.monthlyCost).toEqual(
      expect.objectContaining({ amount: expect.any(Number), currency: expect.any(String) })
    );
    expect(data).toHaveProperty("annualCost");
    expect(data.annualCost).toEqual(
      expect.objectContaining({ amount: expect.any(Number), currency: expect.any(String) })
    );
    // Deprecated flat aliases (mrr/arr/pax8MonthlyCost) were dropped in
    // this revision — v0.1.0 is pre-publish so no external contract to
    // preserve.
    expect(data).not.toHaveProperty("mrr");
    expect(data).not.toHaveProperty("arr");
    expect(data).not.toHaveProperty("pax8MonthlyCost");
    expect(data).not.toHaveProperty("pax8AnnualCost");
    // The mrrAtRisk alias was removed pre-launch.
    expect(data).not.toHaveProperty("mrrAtRisk");
  });

  it("--help mentions the dashboard command name", async () => {
    const result = await runCliExpectSuccess(["dashboard", "--help"]);
    expect(result.stdout).toContain("dashboard");
    expect(result.stdout.toLowerCase()).toContain("snapshot");
  });

  it("is listed in `pax8 --help` (canonical command surfaces in top-level help)", async () => {
    const result = await runCliExpectSuccess(["--help"]);
    expect(result.stdout).toContain("dashboard");
  });

  // #613: pre-fix, dashboard fetched a single page of subscriptions and
  // silently truncated portfolio totals for partners with >1000 subs. The
  // large-scale fixture (5000 subs across 5 pages) is the smallest realistic
  // exercise of the bug: pre-fix this returned `activeSubscriptions: 770`
  // and `monthlyCost ≈ £6M` (the active subset of the first 1000); post-fix
  // it walks all 5 pages via `streamAll()` and returns the full-portfolio
  // count + cost. Tests pin the post-fix shape against the pre-fix
  // ceiling so a regression that re-introduces the truncation would fail
  // here loudly.
  it("at large scale walks every page — no silent truncation (#613)", async () => {
    const result = await runCliExpectSuccess(["dashboard", "--json"], {
      PAX8_DEMO_SCALE: "large",
    });
    const data = JSON.parse(result.stdout);
    // The 5000-sub fixture has way more active subs than would fit in a
    // single 1000-page response. Pre-fix this number was ~770; post-fix it
    // must be > 1000 (the page size) — anything in that range indicates
    // streamAll didn't walk to the end.
    expect(data.activeSubscriptions).toBeGreaterThan(1000);
    // And the truncation warning must NOT be in stderr — pre-fix it was the
    // only signal a user got that their numbers were wrong.
    expect(result.stderr).not.toMatch(/page limit|results may be incomplete/);
  });
});

describe("pax8 dashboard (removed)", () => {
  it("`pax8 dashboard` no longer resolves — the deprecated alias was removed pre-launch", async () => {
    const result = await runCliExpectFailure(["status", "--json"]);
    expect(result.exitCode).not.toBe(0);
  });

  it("`pax8 --help` does not advertise a `status` command", async () => {
    const result = await runCliExpectSuccess(["--help"]);
    expect(result.stdout).not.toMatch(/^\s+status\b/m);
  });
});
