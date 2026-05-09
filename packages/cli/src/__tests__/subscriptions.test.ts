// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("pax8 subscriptions list", () => {
  it("lists subscriptions in demo mode", async () => {
    const result = await runCliExpectSuccess(["subscriptions", "list"]);
    // Non-TTY defaults to JSON
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("productName");
    expect(data[0]).toHaveProperty("quantity");
  });

  it("filters by company ID", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "list",
      "--company",
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    for (const sub of data) {
      expect(sub.companyId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    }
  });

  it("supports --json output", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "list",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]).toHaveProperty("status");
  });

  it("shows help text", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "list",
      "--help",
    ]);
    expect(result.stdout).toContain("List subscriptions");
    expect(result.stdout).toContain("--company");
    expect(result.stdout).toContain("Examples:");
  });

  it("surfaces currencyCode in --json (USD baseline + non-USD fixture)", async () => {
    // The Coastline E3 fixture is seeded as `currencyCode: "EUR"`; everything
    // else is either USD or undefined. Exercises the field added in #273
    // (fixes #6) and confirms the wire passes through `--json` output.
    const result = await runCliExpectSuccess([
      "subscriptions",
      "list",
      "--company",
      "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    const eurSub = data.find((s: { id: string }) => s.id === "sub-coastline-e3-001");
    expect(eurSub).toBeDefined();
    expect(eurSub.currencyCode).toBe("EUR");
  });

  it("--with-actions wraps in { subscriptions, nextActions }", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "list",
      "--json",
      "--with-actions",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("subscriptions");
    expect(data).toHaveProperty("nextActions");
    expect(Array.isArray(data.subscriptions)).toBe(true);
    expect(Array.isArray(data.nextActions)).toBe(true);
    expect(data.nextActions.length).toBeGreaterThan(0);
    for (const action of data.nextActions) {
      expect(action).toHaveProperty("command");
      expect(action).toHaveProperty("description");
    }
  });
});

describe("pax8 subscriptions show", () => {
  it("shows subscription details", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "show",
      "sub-summit-m365bp-001",
    ]);
    const data = JSON.parse(result.stdout);
    // `show` returns a single object, not an array (#208)
    expect(Array.isArray(data)).toBe(false);
    expect(data.id).toBe("sub-summit-m365bp-001");
    expect(data.productName).toBe("Microsoft 365 Business Premium [New Commerce Experience]");
  });

  it("shows subscription with --history", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "show",
      "sub-summit-m365bp-001",
      "--history",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(false);
    expect(data).toHaveProperty("history");
    expect(Array.isArray(data.history)).toBe(true);
    expect(data.history.length).toBeGreaterThan(0);
    expect(data.history[0]).toHaveProperty("field");
  });

  it("shows help text", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "show",
      "--help",
    ]);
    expect(result.stdout).toContain("Show subscription details");
    expect(result.stdout).toContain("--history");
  });
});

describe("pax8 subscriptions renewals", () => {
  it("shows upcoming renewals", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("companyName");
    expect(data[0]).toHaveProperty("productName");
    expect(data[0]).toHaveProperty("daysUntilRenewal");
    expect(data[0]).toHaveProperty("renewalDate");
  });

  it("--with-actions wraps in { renewals, nextActions }", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--with-actions",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("renewals");
    expect(data).toHaveProperty("nextActions");
    expect(Array.isArray(data.renewals)).toBe(true);
    expect(Array.isArray(data.nextActions)).toBe(true);
    if (data.nextActions.length > 0) {
      expect(data.nextActions[0]).toHaveProperty("command");
      expect(data.nextActions[0]).toHaveProperty("description");
    }
  });

  it("filters by --within 7d", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--within",
      "7d",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    for (const item of data) {
      expect(item.daysUntilRenewal).toBeLessThanOrEqual(7);
    }
  });

  it("shows help text", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--help",
    ]);
    expect(result.stdout).toContain("upcoming subscription renewals");
    expect(result.stdout).toContain("--within");
    expect(result.stdout).toContain("Examples:");
  });

  // ─── #295: arrAtRisk companion + canonical MRR/ARR definitions ────────────
  it("includes arrRenewing = mrrRenewing * 12 for every renewal in --json", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--within",
      "365d",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    for (const item of data) {
      // Canonical names (#298).
      expect(item).toHaveProperty("mrrRenewing");
      expect(item).toHaveProperty("arrRenewing");
      // Deprecated aliases — kept for one minor version cycle (#298).
      expect(item).toHaveProperty("mrrAtRisk");
      expect(item).toHaveProperty("arrAtRisk");
      // JSON output rounds to 2dp; allow a tiny rounding delta.
      expect(item.arrRenewing).toBeCloseTo(item.mrrRenewing * 12, 1);
      // Aliases mirror canonical values exactly.
      expect(item.mrrAtRisk).toBe(item.mrrRenewing);
      expect(item.arrAtRisk).toBe(item.arrRenewing);
    }
  });

  it("renewals --help shows canonical MRR/ARR definitions", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--help",
    ]);
    expect(result.stdout).toContain("Metric definitions:");
    expect(result.stdout).toContain("MRR (Monthly Recurring Revenue)");
    expect(result.stdout).toContain("ARR (Annual Recurring Revenue): MRR × 12");
    expect(result.stdout).toContain("Partner Gross MRR");
  });

  it("renewals --help disambiguates from Pax8 Revenue at Risk Predictor", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--help",
    ]);
    expect(result.stdout).toContain("renewal exposure");
    expect(result.stdout).toContain("not churn risk prediction");
    expect(result.stdout).toContain("Revenue at Risk Predictor");
  });
});

describe("pax8 subscriptions update", () => {
  it("shows help text", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "update",
      "--help",
    ]);
    expect(result.stdout).toContain("Update a subscription");
    expect(result.stdout).toContain("--quantity");
    expect(result.stdout).toContain("--billing-term");
  });

  it("warns when no changes specified", async () => {
    const result = await runCli([
      "subscriptions",
      "update",
      "sub-summit-m365bp-001",
    ]);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/[Nn]o changes/);
  });

  // ─── Commitment-aware pre-flight (#293) ───────────────────────────────────
  // The Pax8 marketplace API blocks quantity decreases and billing-term
  // changes during the commitment term. The CLI catches both pre-flight so
  // the user gets actionable guidance instead of an opaque API rejection.
  // `sub-summit-m365bp-001` is on a 1-Year commitment that ends 3 days from
  // now (current quantity 85, billing term Annual) — a stable mid-commitment
  // fixture. `sub-redwood-acronis-007` and `sub-bright-m365bb-001` are
  // monthly with no commitment. `sub-acme-aad-003` carries a commitment whose
  // endDate is in the past (added in #293 specifically for this branch).
  describe("commitment-aware pre-flight", () => {
    it("blocks quantity DECREASE on a sub with active commitment", async () => {
      const result = await runCliExpectFailure([
        "subscriptions",
        "update",
        "sub-summit-m365bp-001",
        "--quantity",
        "5",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/Quantity decreases are not permitted/);
    });

    it("blocks quantity DECREASE before any API call (--json envelope code)", async () => {
      const result = await runCliExpectFailure([
        "subscriptions",
        "update",
        "sub-summit-m365bp-001",
        "--quantity",
        "5",
        "--yes",
        "--json",
      ]);
      expect(result.stderr).toContain("ERROR_API_VALIDATION");
    });

    it("blocks BILLING-TERM change on a sub with active commitment", async () => {
      const result = await runCliExpectFailure([
        "subscriptions",
        "update",
        "sub-summit-m365bp-001",
        "--billing-term",
        "Monthly",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/Billing-term changes are not permitted/);
    });

    it("allows quantity INCREASE on a sub with active commitment", async () => {
      const result = await runCliExpectSuccess([
        "subscriptions",
        "update",
        "sub-summit-m365bp-001",
        "--quantity",
        "100",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].quantity).toBe(100);
    });

    it("allows update on a sub with NO commitment (monthly billing)", async () => {
      // Monthly sub, no commitment — quantity decrease should pass through.
      const result = await runCliExpectSuccess([
        "subscriptions",
        "update",
        "sub-redwood-acronis-007",
        "--quantity",
        "10",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data[0].quantity).toBe(10);
    });

    it("allows update on a sub with PAST commitment endDate", async () => {
      // Past commitment → treat as post-commitment; updates pass through.
      const result = await runCliExpectSuccess([
        "subscriptions",
        "update",
        "sub-acme-aad-003",
        "--quantity",
        "5",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data[0].quantity).toBe(5);
    });
  });
});

describe("pax8 subscriptions cancel", () => {
  it("shows help text", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "cancel",
      "--help",
    ]);
    expect(result.stdout).toContain("Cancel a subscription");
    expect(result.stdout).toContain("--cancel-date");
  });

  it("errors with invalid subscription ID", async () => {
    const result = await runCliExpectFailure([
      "subscriptions",
      "cancel",
      "totally-bogus-id-not-real",
      "--yes",
    ]);
    const combined = result.stdout + result.stderr;
    expect(combined.length).toBeGreaterThan(0);
  });

  it("rejects malformed --cancel-date", async () => {
    const result = await runCliExpectFailure([
      "subscriptions",
      "cancel",
      "sub-summit-m365bp-001",
      "--cancel-date",
      "12/31/2026",
      "--yes",
    ]);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/cancel-date/i);
    expect(combined).toMatch(/YYYY-MM-DD/);
  });

  it("rejects calendar-impossible --cancel-date", async () => {
    const result = await runCliExpectFailure([
      "subscriptions",
      "cancel",
      "sub-summit-m365bp-001",
      "--cancel-date",
      "2026-02-30",
      "--yes",
    ]);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/cancel-date/i);
  });

  it("emits ERROR_INVALID_INPUT for bad --cancel-date in --json mode", async () => {
    const result = await runCliExpectFailure([
      "subscriptions",
      "cancel",
      "sub-summit-m365bp-001",
      "--cancel-date",
      "not-a-date",
      "--yes",
      "--json",
    ]);
    expect(result.stderr).toContain("ERROR_INVALID_INPUT");
  });

  it("schedules cancellation with a valid --cancel-date", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "cancel",
      "sub-summit-m365bp-001",
      "--cancel-date",
      "2026-12-31",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]).toMatchObject({
      id: "sub-summit-m365bp-001",
      status: "Cancelled",
      cancelDate: "2026-12-31",
    });
  });

  // Regression for #294: commitment-aware preview + safe-path defaults.
  describe("commitment-aware behavior (#294)", () => {
    // sub-summit-m365bp-001 is a 1-Year committed sub in demo data — its
    // commitment.endDate is in the future.
    const COMMITTED_SUB = "sub-summit-m365bp-001";

    it("defaults to commitment term end date on a committed sub (no flag)", async () => {
      const result = await runCliExpectSuccess([
        "subscriptions",
        "cancel",
        COMMITTED_SUB,
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      // Safe-path default: cancelDate is set to a real future date (the
      // commitment term end date), NOT undefined (which would be cancel-today).
      expect(data[0]).toMatchObject({
        id: COMMITTED_SUB,
        status: "Cancelled",
      });
      expect(typeof data[0].cancelDate).toBe("string");
      expect(data[0].cancelDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("--immediately overrides the safe-path default", async () => {
      const result = await runCliExpectSuccess([
        "subscriptions",
        "cancel",
        COMMITTED_SUB,
        "--immediately",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      // cancel-today: no cancelDate field in the output.
      expect(data[0]).toMatchObject({
        id: COMMITTED_SUB,
        status: "Cancelled",
      });
      expect(data[0].cancelDate).toBeUndefined();
    });

    it("respects --cancel-date over both default and --immediately", async () => {
      const result = await runCliExpectSuccess([
        "subscriptions",
        "cancel",
        COMMITTED_SUB,
        "--cancel-date",
        "2027-01-15",
        "--immediately", // explicit --cancel-date should win
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data[0].cancelDate).toBe("2027-01-15");
    });

    // Vocabulary discipline: per Pax8 TOS + canonical macros, the consequence
    // is "fees paid are nonrefundable" (billing continues), not an
    // early-termination fee. The CLI must NOT use ETF / "early termination" /
    // "fee" / "penalty" framing on the cancel surface — those misrepresent
    // how the system works.
    it("never uses ETF / fee / penalty vocabulary in output", async () => {
      // Run without --json so the human preview block surfaces too. We can't
      // force TTY in the subprocess (matrix limitation), but we capture all
      // output streams and assert vocabulary discipline across stderr + stdout.
      const result = await runCliExpectSuccess([
        "subscriptions",
        "cancel",
        COMMITTED_SUB,
        "--yes",
      ]);
      const combined = result.stdout + "\n" + result.stderr;
      // Each forbidden token represents a vocabulary mismatch with Pax8
      // canonical phrasing; a regression here means we drifted back toward
      // the ETF framing that the TOS doesn't support.
      expect(combined).not.toMatch(/\bETF\b/);
      expect(combined).not.toMatch(/early[- ]termination/i);
      expect(combined).not.toMatch(/\bpenalty\b/i);
      // "fee" appears in phrases like "no early-termination FEE" — guard
      // against the term in any negative-financial context. The intentional
      // word is "billing" (which continues per the TOS).
      expect(combined).not.toMatch(/cancellation[- ]fee/i);
    });

    it("--help documents the safe-path default and --immediately escape hatch", async () => {
      const result = await runCliExpectSuccess([
        "subscriptions",
        "cancel",
        "--help",
      ]);
      expect(result.stdout).toContain("--immediately");
      expect(result.stdout).toContain("commitment term end date");
      // Make sure the help doesn't reintroduce ETF vocabulary either.
      expect(result.stdout).not.toMatch(/\bETF\b/);
      expect(result.stdout).not.toMatch(/early[- ]termination[- ]fee/i);
    });
  });
});

describe("pax8 subscriptions", () => {
  it("shows help with subcommands", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "--help",
    ]);
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("show");
    expect(result.stdout).toContain("update");
    expect(result.stdout).toContain("cancel");
    expect(result.stdout).toContain("renewals");
  });
});
