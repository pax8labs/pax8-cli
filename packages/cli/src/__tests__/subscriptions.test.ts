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

  it("emits BOTH `createdDate` and canonical `createdAt` on every row (#385 deprecation window)", async () => {
    // #385: timestamp field standardization. `createdAt` is the canonical
    // past-tense camelCase name; `createdDate` is preserved as a deprecated
    // alias for one minor version cycle so `--json` consumers don't break.
    const result = await runCliExpectSuccess([
      "subscriptions",
      "list",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.length).toBeGreaterThan(0);
    for (const row of data) {
      expect(row).toHaveProperty("createdDate");
      expect(row).toHaveProperty("createdAt");
      expect(row.createdAt).toBe(row.createdDate);
    }
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

  // #250: `--status` help text must enumerate every value documented for
  // `GET /subscriptions`'s `status` query parameter in the public OpenAPI.
  // Previously the help listed a "...etc." subset that hid 6 of 10 values.
  it("--status help advertises every documented API enum value (#250)", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "list",
      "--help",
    ]);
    const DOCUMENTED_STATUSES = [
      "Active",
      "Cancelled",
      "PendingManual",
      "PendingAutomated",
      "PendingCancel",
      "WaitingForDetails",
      "Trial",
      "Converted",
      "PendingActivation",
      "Activated",
    ];
    for (const status of DOCUMENTED_STATUSES) {
      expect(result.stdout).toContain(status);
    }
    // No "etc." escape hatch — the list must be exhaustive.
    expect(result.stdout).not.toMatch(/--status[^)]*etc\./);
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

  // #408 / partner-walkthrough finding #2: a typo'd --status used to silently
  // return [] from the API. Now fails fast with the allowed enum list so the
  // partner can self-correct without guessing.
  describe("--status fail-fast validation (#408)", () => {
    it("rejects an unknown status with the allowed list", async () => {
      const result = await runCliExpectFailure([
        "subscriptions",
        "list",
        "--status",
        "FooBar",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain(`Invalid value for --status: "FooBar"`);
      expect(combined).toContain("Active");
      expect(combined).toContain("Cancelled");
    });

    it("emits ERROR_INVALID_INPUT under --json", async () => {
      const result = await runCliExpectFailure([
        "subscriptions",
        "list",
        "--status",
        "FooBar",
        "--json",
      ]);
      expect(result.stderr).toContain("ERROR_INVALID_INPUT");
    });

    it("accepts canonical Active and still returns rows", async () => {
      const result = await runCliExpectSuccess([
        "subscriptions",
        "list",
        "--status",
        "Active",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
    });
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

  // ─── --billing-term enum mirrors the Pax8 API request body ──────────────
  // The CLI used to advertise only "Monthly or Annual" in help text — a
  // hand-curated subset that didn't match the API. Fred Lintz flagged that
  // the API actually accepts seven values. The CLI now mirrors the API
  // request-body enum at PUT /subscriptions/{id}, fail-fasts on values
  // outside it, and lets vendor-specific rejections come back from the
  // API (rather than CLI-predicting them).
  //
  // Verified enum source: docs/triage/billing-term-update-enum.md
  describe("--billing-term mirrors API enum", () => {
    // Every enum value the API accepts must pass the CLI's fail-fast check.
    // We don't assert end-to-end success (which would require a non-committed
    // sub for each term shape); only that the validator doesn't reject the
    // value with "Invalid --billing-term".
    const API_ENUM_VALUES = [
      "Monthly",
      "Annual",
      "2-Year",
      "3-Year",
      "One-Time",
      "Trial",
      "Activation",
    ] as const;

    for (const term of API_ENUM_VALUES) {
      it(`accepts --billing-term ${term} past CLI validation`, async () => {
        // Run against a committed sub so the call short-circuits at the
        // commitment pre-flight (or, for same-term values, falls through to
        // the API). Either outcome confirms the CLI-side enum check passed.
        const result = await runCli([
          "subscriptions",
          "update",
          "sub-summit-m365bp-001",
          "--billing-term",
          term,
          "--yes",
        ]);
        const combined = result.stdout + result.stderr;
        expect(combined).not.toMatch(/Invalid --billing-term/);
      });
    }

    it("rejects an unknown billing-term with a CLI-side error before any API call", async () => {
      const result = await runCliExpectFailure([
        "subscriptions",
        "update",
        "sub-summit-m365bp-001",
        "--billing-term",
        "Quarterly",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain(`Invalid --billing-term "Quarterly"`);
      // The error must list the canonical accepted set so the user can
      // self-correct without reading docs.
      expect(combined).toContain("Monthly | Annual | 2-Year | 3-Year");
    });

    it("rejects case-mismatched input (e.g., 'annual' lowercased)", async () => {
      // This is the practical reason fail-fast validation matters — the API
      // is case-sensitive and a lowercased typo would otherwise propagate
      // to an opaque API rejection.
      const result = await runCliExpectFailure([
        "subscriptions",
        "update",
        "sub-summit-m365bp-001",
        "--billing-term",
        "annual",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain(`Invalid --billing-term "annual"`);
    });

    it("emits ERROR_INVALID_INPUT for invalid value under --json", async () => {
      const result = await runCliExpectFailure([
        "subscriptions",
        "update",
        "sub-summit-m365bp-001",
        "--billing-term",
        "Quarterly",
        "--yes",
        "--json",
      ]);
      expect(result.stderr).toContain("ERROR_INVALID_INPUT");
    });

    it("--help advertises every API enum value", async () => {
      const result = await runCliExpectSuccess([
        "subscriptions",
        "update",
        "--help",
      ]);
      for (const term of API_ENUM_VALUES) {
        expect(result.stdout).toContain(term);
      }
      // Reference to the API-mirroring philosophy is present so future
      // maintainers don't re-narrow the surface.
      expect(result.stdout).toMatch(/Pax8 API request-body enum/i);
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

  // #333: the underlying wire payload was changed from date-only to
  // ISO date-time to match the OpenAPI spec (`format: date-time`). The
  // partner-facing surface (--cancel-date flag input, --json output
  // `cancelDate` field) intentionally stays date-only so existing
  // partner scripts keep working. This test pins that contract.
  it("--cancel-date 2026-06-01 yields a date-only JSON output (#333)", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "cancel",
      "sub-summit-m365bp-001",
      "--cancel-date",
      "2026-06-01",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data[0].cancelDate).toBe("2026-06-01");
    // Pin the shape so a future "normalize the JSON output too" change
    // can't silently break partner scripts that expect YYYY-MM-DD.
    expect(data[0].cancelDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

    // #409: commitment-aware cancel preview. Both branches of the preview
    // text must surface BEFORE the confirmation prompt so the partner sees
    // the timing reality (committed = scheduled, uncommitted = immediate)
    // before they commit to the action. Force table output via
    // PAX8_OUTPUT_FORMAT so we exercise the human-facing preview block
    // through the subprocess (it would default to JSON otherwise).
    it("preview names the commitment end date on a committed sub (#409)", async () => {
      const result = await runCliExpectSuccess(
        [
          "subscriptions",
          "cancel",
          COMMITTED_SUB,
          "--yes",
        ],
        { PAX8_OUTPUT_FORMAT: "table" },
      );
      const combined = result.stdout + result.stderr;
      // Headline phrasing from the issue: "This subscription has an active
      // commitment ending YYYY-MM-DD." The actual date comes from demo
      // fixtures (sub-summit-m365bp-001 ends 3 days from now), so we match
      // the prefix + ISO shape rather than pinning a fixed value.
      expect(combined).toMatch(
        /This subscription has an active commitment ending \d{4}-\d{2}-\d{2}\./,
      );
      // Vocabulary discipline (carries the #294 contract forward).
      expect(combined).not.toMatch(/\bETF\b/);
      expect(combined).not.toMatch(/\bpenalty\b/i);
    });

    it("preview names the immediate-effect path on an uncommitted sub (#409)", async () => {
      // sub-bright-m365bb-001 is a Monthly sub with no commitment in
      // demo data — the exact case the partner walkthrough flagged
      // (Finding #7): cancelling defaults to immediate with no
      // pre-flight signal about timing.
      const UNCOMMITTED_SUB = "sub-bright-m365bb-001";
      const result = await runCliExpectSuccess(
        [
          "subscriptions",
          "cancel",
          UNCOMMITTED_SUB,
          "--yes",
        ],
        { PAX8_OUTPUT_FORMAT: "table" },
      );
      const combined = result.stdout + result.stderr;
      expect(combined).toContain(
        "This subscription has no active commitment. Cancellation will take effect immediately.",
      );
      // The committed-branch headline must NOT appear on an uncommitted sub.
      expect(combined).not.toMatch(/COMMITMENT ACTIVE/);
      expect(combined).not.toMatch(/active commitment ending/);
    });

    it("JSON mode is unchanged for the uncommitted preview branch (#409)", async () => {
      // The new preview text is table-mode only. JSON pipelines must
      // remain a flat one-element array exactly as before.
      const UNCOMMITTED_SUB = "sub-bright-m365bb-001";
      const result = await runCliExpectSuccess([
        "subscriptions",
        "cancel",
        UNCOMMITTED_SUB,
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]).toMatchObject({
        id: UNCOMMITTED_SUB,
        status: "Cancelled",
      });
      expect(data[0].cancelDate).toBeUndefined();
      // The preview narrative must not leak into stdout — pipelines
      // reading `--json` must not see it.
      expect(result.stdout).not.toMatch(/no active commitment/i);
      expect(result.stdout).not.toMatch(/take effect immediately/i);
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
