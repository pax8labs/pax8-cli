// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

// `pax8 report *` was reshaped in feat/reporting-reshape: the old
// `report mrr` / `report growth` commands were deleted in #440
// (misleading partner-revenue framing on Pax8-cost numbers), and
// replaced by three honestly-framed commands. These tests gate the new
// surface AND the regression of the old.

const DISCLAIMER =
  /Numbers shown are Pax8 cost — what Pax8 charges you\. For partner revenue \(what you charge your customers\), combine with sell-through pricing from your PSA\./;

describe("pax8 report (parent)", () => {
  it("lists exactly three subcommands and no mrr/growth references", async () => {
    const { stdout } = await runCliExpectSuccess(["report", "--help"]);
    expect(stdout).toContain("renewals");
    expect(stdout).toContain("concentration");
    expect(stdout).toContain("subscriptions");
    // The two #440-removed subcommands must not appear anywhere in help.
    expect(stdout).not.toMatch(/\bmrr\b/i);
    expect(stdout).not.toMatch(/\bgrowth\b/i);
  });

  it("report mrr returns an unknown-command error", async () => {
    const result = await runCli(["report", "mrr"]);
    expect(result.exitCode).not.toBe(0);
    const combined = (result.stderr + result.stdout).toLowerCase();
    expect(combined).toMatch(/unknown command|invalid command|usage:/);
  });

  it("report growth returns an unknown-command error", async () => {
    const result = await runCli(["report", "growth"]);
    expect(result.exitCode).not.toBe(0);
    const combined = (result.stderr + result.stdout).toLowerCase();
    expect(combined).toMatch(/unknown command|invalid command|usage:/);
  });
});

describe("pax8 report renewals", () => {
  it("default --within 90 returns the canonical JSON shape", async () => {
    const { stdout } = await runCliExpectSuccess(["report", "renewals", "--json"]);
    const data = JSON.parse(stdout);
    expect(data).toMatchObject({
      windowDays: 90,
      totalCount: expect.any(Number),
    });
    expect(Array.isArray(data.renewals)).toBe(true);
    expect(data.totalMonthlyCostExposure).toMatchObject({
      amount: expect.any(Number),
      currency: expect.any(String),
    });
    // Every renewal row must carry the spec-mandated fields wrapped in
    // AmountCurrency where applicable.
    expect(data.renewals.length).toBeGreaterThan(0);
    for (const r of data.renewals) {
      expect(r).toHaveProperty("subscriptionId");
      expect(r).toHaveProperty("companyId");
      expect(r).toHaveProperty("companyName");
      expect(r).toHaveProperty("productName");
      expect(r).toHaveProperty("vendorName");
      expect(r).toHaveProperty("quantity");
      expect(r).toHaveProperty("commitmentTermEndDate");
      expect(r).toHaveProperty("daysUntilEnd");
      expect(r.monthlyCost).toMatchObject({
        amount: expect.any(Number),
        currency: expect.any(String),
      });
    }
    expect(data.totalCount).toBe(data.renewals.length);
  });

  it("--within 30 narrows the window", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "renewals",
      "--within",
      "30",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    expect(data.windowDays).toBe(30);
    for (const r of data.renewals) {
      expect(r.daysUntilEnd).toBeLessThanOrEqual(30);
    }
  });

  it("--within 365 widens the window", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "renewals",
      "--within",
      "365",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    expect(data.windowDays).toBe(365);
    expect(data.renewals.length).toBeGreaterThan(0);
  });

  it("--sort by-cost orders renewals by descending Pax8 monthly cost", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "renewals",
      "--within",
      "180",
      "--sort",
      "by-cost",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    expect(data.renewals.length).toBeGreaterThan(1);
    for (let i = 1; i < data.renewals.length; i++) {
      expect(data.renewals[i].monthlyCost.amount).toBeLessThanOrEqual(
        data.renewals[i - 1].monthlyCost.amount,
      );
    }
  });

  it("--sort by-date orders renewals by ascending daysUntilEnd (default)", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "renewals",
      "--within",
      "180",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    for (let i = 1; i < data.renewals.length; i++) {
      expect(data.renewals[i].daysUntilEnd).toBeGreaterThanOrEqual(
        data.renewals[i - 1].daysUntilEnd,
      );
    }
  });

  it("--vendor filters by vendor name", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "renewals",
      "--within",
      "365",
      "--vendor",
      "Microsoft",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    expect(data.renewals.length).toBeGreaterThan(0);
    for (const r of data.renewals) {
      expect(r.vendorName.toLowerCase()).toContain("microsoft");
    }
  });

  it("--product filters by product name substring", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "renewals",
      "--within",
      "365",
      "--product",
      "Defender",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    for (const r of data.renewals) {
      expect(r.productName.toLowerCase()).toContain("defender");
    }
  });

  it("--company filters by company", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "renewals",
      "--within",
      "365",
      "--company",
      "Summit Healthcare Partners",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    expect(data.renewals.length).toBeGreaterThan(0);
    for (const r of data.renewals) {
      expect(r.companyName).toBe("Summit Healthcare Partners");
    }
  });

  it("rejects non-numeric --within", async () => {
    const result = await runCliExpectFailure([
      "report",
      "renewals",
      "--within",
      "ninety",
    ]);
    expect(result.stderr.toLowerCase()).toContain("within");
  });

  it("accepts integer --within (no suffix required)", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "renewals",
      "--within",
      "60",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    expect(data.windowDays).toBe(60);
  });
});

describe("pax8 report concentration", () => {
  for (const groupBy of ["client", "vendor", "product"] as const) {
    it(`--by ${groupBy} returns the canonical JSON shape`, async () => {
      const { stdout } = await runCliExpectSuccess([
        "report",
        "concentration",
        "--by",
        groupBy,
        "--json",
      ]);
      const data = JSON.parse(stdout);
      expect(data.groupBy).toBe(groupBy);
      expect(data.totalMonthlyCost).toMatchObject({
        amount: expect.any(Number),
        currency: expect.any(String),
      });
      expect(Array.isArray(data.concentration)).toBe(true);
      expect(data.concentration.length).toBeGreaterThan(0);
      for (const row of data.concentration) {
        expect(row).toHaveProperty("rank");
        expect(row).toHaveProperty("entityId");
        expect(row).toHaveProperty("entityName");
        expect(row).toHaveProperty("activeSubscriptionCount");
        expect(row).toHaveProperty("sharePercent");
        expect(row).toHaveProperty("cumulativeSharePercent");
        expect(row.monthlyCost).toMatchObject({
          amount: expect.any(Number),
          currency: expect.any(String),
        });
      }
    });
  }

  it("--top 5 limits results to at most 5 rows", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "concentration",
      "--by",
      "client",
      "--top",
      "5",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    expect(data.concentration.length).toBeLessThanOrEqual(5);
  });

  it("--threshold filters by share-percent", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "concentration",
      "--by",
      "client",
      "--threshold",
      "10",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    for (const row of data.concentration) {
      expect(row.sharePercent).toBeGreaterThan(10);
    }
  });

  it("cumulativeSharePercent is monotonically non-decreasing and <= 100", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "concentration",
      "--by",
      "vendor",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    let prev = 0;
    for (const row of data.concentration) {
      expect(row.cumulativeSharePercent).toBeGreaterThanOrEqual(prev);
      // Allow tiny floating-point overshoot (e.g. 100.01 from rounding).
      expect(row.cumulativeSharePercent).toBeLessThanOrEqual(100.01);
      prev = row.cumulativeSharePercent;
    }
  });

  it("rank ordering reflects descending monthly cost", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "concentration",
      "--by",
      "client",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    for (let i = 1; i < data.concentration.length; i++) {
      expect(data.concentration[i].monthlyCost.amount).toBeLessThanOrEqual(
        data.concentration[i - 1].monthlyCost.amount,
      );
    }
    // Rank field is 1-based and sequential.
    data.concentration.forEach((r: { rank: number }, i: number) => {
      expect(r.rank).toBe(i + 1);
    });
  });

  it("errors cleanly when --by is missing", async () => {
    const result = await runCliExpectFailure(["report", "concentration"]);
    expect(result.stderr.toLowerCase()).toContain("--by");
  });

  // #517: missing --by is enforced by Commander at parse time, BEFORE
  // buildContext() / the subscriptions fetch runs. We verify the spinner
  // never fired by asserting "Fetching subscriptions" appears nowhere in
  // the combined output. If we ever regress to the throw-from-action
  // form, this catches it.
  it("rejects missing --by at parse time (no spinner / fetch)", async () => {
    const result = await runCliExpectFailure(["report", "concentration"]);
    const combined = result.stdout + result.stderr;
    expect(combined).not.toContain("Fetching subscriptions");
    // Commander's required-option error format.
    expect(result.stderr.toLowerCase()).toMatch(/required option.*--by/);
  });

  it("errors on invalid --by value", async () => {
    const result = await runCliExpectFailure([
      "report",
      "concentration",
      "--by",
      "bogus",
    ]);
    expect(result.stderr.toLowerCase()).toContain("--by");
  });

  // #516: `client` is the canonical noun (per #317). `customer` and
  // `company` are accepted as deprecated aliases with a one-line stderr
  // warning, and the response payload normalizes to `client`.
  for (const alias of ["customer", "company"] as const) {
    it(`accepts --by ${alias} as a deprecated alias for client (warns on stderr)`, async () => {
      const { stdout, stderr } = await runCliExpectSuccess([
        "report",
        "concentration",
        "--by",
        alias,
        "--json",
      ]);
      const data = JSON.parse(stdout);
      expect(data.groupBy).toBe("client");
      expect(stderr.toLowerCase()).toContain("deprecated");
      expect(stderr).toContain(alias);
    });
  }
});

describe("pax8 report subscriptions", () => {
  // #613 Phase 2: pre-fix the report grouped subs by vendor / client /
  // product / billing-term using only the first page of subscriptions
  // (1000 cap), so partner-cost group sums silently undercounted for
  // any portfolio bigger than that. The large fixture (5000 subs, 3752
  // active) is the smallest realistic exercise of the bug. Asserting
  // `totalActiveSubscriptions > 1000` (the page size) is the count-
  // derived check claude-review on #629 specifically called out as
  // stronger than the warning-absence assertion alone — a regression
  // that returns only page 1 would fail loudly here.
  it("at large scale aggregates over the full portfolio (#613)", async () => {
    const result = await runCliExpectSuccess(
      ["report", "subscriptions", "--by", "vendor", "--json"],
      { PAX8_DEMO_SCALE: "large" },
    );
    const data = JSON.parse(result.stdout);
    expect(data.totalActiveSubscriptions).toBeGreaterThan(1000);
    expect(result.stderr).not.toMatch(/page limit|results may be incomplete/);
  });

  for (const groupBy of [
    "client",
    "vendor",
    "product",
    "billing-term",
  ] as const) {
    it(`--by ${groupBy} returns the canonical JSON shape`, async () => {
      const { stdout } = await runCliExpectSuccess([
        "report",
        "subscriptions",
        "--by",
        groupBy,
        "--json",
      ]);
      const data = JSON.parse(stdout);
      expect(data.groupBy).toBe(groupBy);
      expect(data.totalActiveSubscriptions).toBeGreaterThan(0);
      expect(data.totalMonthlyCost).toMatchObject({
        amount: expect.any(Number),
        currency: expect.any(String),
      });
      expect(Array.isArray(data.groups)).toBe(true);
      expect(data.groups.length).toBeGreaterThan(0);
      for (const g of data.groups) {
        expect(g).toHaveProperty("groupName");
        expect(g).toHaveProperty("subscriptionCount");
        expect(g).toHaveProperty("totalQuantity");
        expect(g.monthlyCost).toMatchObject({
          amount: expect.any(Number),
          currency: expect.any(String),
        });
        expect(g.annualCost).toMatchObject({
          amount: expect.any(Number),
          currency: expect.any(String),
        });
      }
    });
  }

  it("--by billing-term groups Monthly / Annual / 2-Year / 3-Year separately", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "subscriptions",
      "--by",
      "billing-term",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    const groupNames = data.groups.map((g: { groupName: string }) => g.groupName);
    expect(groupNames).toContain("Monthly");
    expect(groupNames).toContain("Annual");
    expect(groupNames).toContain("2-Year");
    expect(groupNames).toContain("3-Year");
  });

  // Post-#439 normalization fix: 2-Year and 3-Year monthly cost MUST equal
  // (price × quantity) / 24 and / 36 respectively. The demo fixture has a
  // Coastline 2-Year M365 E3 (40 seats × $36 / 24 = $60/mo) and a Pinnacle
  // 3-Year M365 E5 (15 seats × $57 / 36 = $23.75/mo).
  it("--by billing-term 2-Year cost reflects post-#439 normalization (divide by 24)", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "subscriptions",
      "--by",
      "billing-term",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    const twoYear = data.groups.find(
      (g: { groupName: string }) => g.groupName === "2-Year",
    );
    expect(twoYear).toBeDefined();
    // Coastline's 40 × $36 / 24 = $60/mo. Allow a tiny rounding tolerance.
    expect(twoYear.monthlyCost.amount).toBeCloseTo(60, 1);
  });

  it("--by billing-term 3-Year cost reflects post-#439 normalization (divide by 36)", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "subscriptions",
      "--by",
      "billing-term",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    const threeYear = data.groups.find(
      (g: { groupName: string }) => g.groupName === "3-Year",
    );
    expect(threeYear).toBeDefined();
    // Pinnacle's 15 × $57 / 36 = $23.75/mo.
    expect(threeYear.monthlyCost.amount).toBeCloseTo(23.75, 1);
  });

  it("annualCost equals monthlyCost × 12 per group", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "subscriptions",
      "--by",
      "vendor",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    for (const g of data.groups) {
      expect(g.annualCost.amount).toBeCloseTo(g.monthlyCost.amount * 12, 1);
    }
  });

  it("--company filters subscriptions to that customer", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "subscriptions",
      "--by",
      "product",
      "--company",
      "Redwood Manufacturing",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    expect(data.totalActiveSubscriptions).toBeGreaterThan(0);
    // Redwood's portfolio is bounded — fewer subs than the whole portfolio.
    expect(data.totalActiveSubscriptions).toBeLessThan(20);
  });

  it("--vendor filters to that vendor's products only", async () => {
    const { stdout } = await runCliExpectSuccess([
      "report",
      "subscriptions",
      "--by",
      "product",
      "--vendor",
      "Microsoft",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    expect(data.totalActiveSubscriptions).toBeGreaterThan(0);
    // None of the resulting product groups should be a non-Microsoft
    // product. Soft check via product name prefix to avoid coupling to
    // vendor-resolution internals.
    for (const g of data.groups) {
      // Microsoft products in the demo catalog all start with "Microsoft "
      // or "Exchange Online" — those are Microsoft as well.
      expect(g.groupName).toMatch(/Microsoft|Exchange Online/);
    }
  });

  it("errors on invalid --by value", async () => {
    const result = await runCliExpectFailure([
      "report",
      "subscriptions",
      "--by",
      "bogus",
    ]);
    expect(result.stderr.toLowerCase()).toContain("--by");
  });

  // #516: `client` is the canonical noun (per #317). `customer` and
  // `company` are accepted as deprecated aliases with a one-line stderr
  // warning, and the response payload normalizes to `client`.
  for (const alias of ["customer", "company"] as const) {
    it(`accepts --by ${alias} as a deprecated alias for client (warns on stderr)`, async () => {
      const { stdout, stderr } = await runCliExpectSuccess([
        "report",
        "subscriptions",
        "--by",
        alias,
        "--json",
      ]);
      const data = JSON.parse(stdout);
      expect(data.groupBy).toBe("client");
      expect(stderr.toLowerCase()).toContain("deprecated");
      expect(stderr).toContain(alias);
    });
  }
});

describe("standardized Pax8-cost disclaimer footer", () => {
  // The exact string is enforced verbatim across every command that
  // surfaces partner-side Pax8 cost. The regex matches the same form
  // help-json-output.test.ts uses for the seven already-shipped commands.
  for (const argv of [
    ["report", "renewals", "--help"],
    ["report", "concentration", "--help"],
    ["report", "subscriptions", "--help"],
  ]) {
    it(`appears on pax8 ${argv.slice(0, -1).join(" ")} --help`, async () => {
      const { stdout } = await runCliExpectSuccess(argv);
      expect(stdout).toMatch(DISCLAIMER);
    });
  }
});
