// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

/**
 * Subprocess tests for `pax8 today` — the morning-brief command.
 *
 * Pins the contracts that:
 *   1. The JSON envelope shape exists and is internally consistent
 *      (composite cap, summary counts match section sizes).
 *   2. Every `items[].action` and every `nextActions[]` entry honors the
 *      argv contract from #562 — `args[0] === "pax8"`, args is a non-empty
 *      string array. Agents spawn `args.slice(1)`; never tokenize `command`.
 *   3. `today` walks the full subscription set at large scale, not the
 *      first page (the silent-truncation class closed by #613/#629).
 */

interface TodayAction {
  command: string;
  args: string[];
  description: string;
}

interface TodayItem {
  kind: string;
  priority: "high" | "medium" | "low";
  companyName: string;
  summary: string;
  daysUntil?: number;
  monthlyImpact: { amount: number; currency: string };
  action: TodayAction;
}

interface TodayPayload {
  asOf: string;
  items: TodayItem[];
  summary: {
    totalItems: number;
    urgentRenewals: number;
    auditDiscrepancies: number;
    growthOpportunities: number;
    expiringTrials: number;
    upcomingRenewals: number;
    monthlyImpact: { amount: number; currency: string };
    dollarsOnTable: number;
    truncated: number;
  };
  nextActions: TodayAction[];
}

describe("pax8 today", () => {
  it("--json emits a composite envelope with items, summary, nextActions", async () => {
    const result = await runCliExpectSuccess(["today", "--json"]);
    const payload = JSON.parse(result.stdout) as TodayPayload;
    expect(payload).toHaveProperty("asOf");
    expect(typeof payload.asOf).toBe("string");
    expect(payload.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.summary).toEqual(
      expect.objectContaining({
        totalItems: expect.any(Number),
        urgentRenewals: expect.any(Number),
        auditDiscrepancies: expect.any(Number),
        growthOpportunities: expect.any(Number),
        expiringTrials: expect.any(Number),
        upcomingRenewals: expect.any(Number),
        dollarsOnTable: expect.any(Number),
        truncated: expect.any(Number),
      }),
    );
    expect(payload.summary.monthlyImpact).toEqual(
      expect.objectContaining({ amount: expect.any(Number), currency: expect.any(String) }),
    );
    expect(Array.isArray(payload.nextActions)).toBe(true);
  });

  it("--json caps items at 10 (composite cap) and summary.totalItems matches", async () => {
    const result = await runCliExpectSuccess(["today", "--json"]);
    const payload = JSON.parse(result.stdout) as TodayPayload;
    expect(payload.items.length).toBeLessThanOrEqual(10);
    expect(payload.summary.totalItems).toBe(payload.items.length);
  });

  // Section counts must equal what's actually in items[]. Pre-fix, counts
  // read from the per-section-capped `sections` (max 3×5=15) while
  // totalItems read from `flat` (cap 10) — so when the composite cap
  // fired, the section counts could sum to more than totalItems and
  // reference items absent from items[]. An agent filtering
  // `items[].kind === "renewal-urgent"` expected exactly
  // `summary.urgentRenewals` results; the pre-fix shape broke that.
  it("--json: section counts sum to totalItems and match items[] grouping", async () => {
    const result = await runCliExpectSuccess(["today", "--json"]);
    const payload = JSON.parse(result.stdout) as TodayPayload;
    const s = payload.summary;
    expect(
      s.urgentRenewals + s.auditDiscrepancies + s.growthOpportunities + s.expiringTrials + s.upcomingRenewals,
    ).toBe(s.totalItems);
    // Each section count equals the number of items with the matching kind.
    expect(payload.items.filter((i) => i.kind === "renewal-urgent").length).toBe(s.urgentRenewals);
    expect(payload.items.filter((i) => i.kind === "audit-overcharge" || i.kind === "audit-undercharge").length).toBe(s.auditDiscrepancies);
    expect(payload.items.filter((i) => i.kind === "growth-high").length).toBe(s.growthOpportunities);
    expect(payload.items.filter((i) => i.kind === "trial-expiring").length).toBe(s.expiringTrials);
    expect(payload.items.filter((i) => i.kind === "renewal-upcoming").length).toBe(s.upcomingRenewals);
  });

  // Growth section is sourced from `priority === "high"` recs; the items
  // must carry `priority: "high"` so agents filtering on that field find
  // exactly the opportunities the section is named after.
  it("--json: growth-high items carry priority='high' (not the demoted 'medium')", async () => {
    const result = await runCliExpectSuccess(["today", "--json"]);
    const payload = JSON.parse(result.stdout) as TodayPayload;
    const growth = payload.items.filter((i) => i.kind === "growth-high");
    for (const g of growth) {
      expect(g.priority).toBe("high");
    }
  });

  it("--json: every items[].action.args[0] is 'pax8' (argv contract #562)", async () => {
    const result = await runCliExpectSuccess(["today", "--json"]);
    const payload = JSON.parse(result.stdout) as TodayPayload;
    // At default scale the demo fixture has at least one urgent renewal +
    // audit findings + recommendations, so items is non-empty.
    expect(payload.items.length).toBeGreaterThan(0);
    for (const item of payload.items) {
      expect(Array.isArray(item.action.args)).toBe(true);
      expect(item.action.args.length).toBeGreaterThanOrEqual(2);
      expect(item.action.args[0]).toBe("pax8");
      expect(typeof item.action.command).toBe("string");
      expect(item.action.command.length).toBeGreaterThan(0);
      // Every arg is a string — no nested objects or undefined slots that
      // would break a Bash-tool argv spawn.
      for (const a of item.action.args) {
        expect(typeof a).toBe("string");
      }
    }
  });

  it("--json: every nextActions[] entry honors the argv contract", async () => {
    const result = await runCliExpectSuccess(["today", "--json"]);
    const payload = JSON.parse(result.stdout) as TodayPayload;
    for (const action of payload.nextActions) {
      expect(Array.isArray(action.args)).toBe(true);
      expect(action.args.length).toBeGreaterThanOrEqual(2);
      expect(action.args[0]).toBe("pax8");
      for (const a of action.args) {
        expect(typeof a).toBe("string");
      }
      expect(typeof action.command).toBe("string");
      expect(typeof action.description).toBe("string");
    }
  });

  // #613 regression. At PAX8_DEMO_SCALE=large the fixture has 5,000 subs
  // across 5 pages. Pre-#629 a single-page aggregator would have
  // computed renewals + audit + recs against just the first 1000 (or
  // worse, the first 200). Today walks every page via streamAll, so the
  // visible counts must reflect the full portfolio.
  it("at large scale walks every page — no silent truncation (#613)", async () => {
    const result = await runCliExpectSuccess(["today", "--json"], {
      PAX8_DEMO_SCALE: "large",
    });
    const payload = JSON.parse(result.stdout) as TodayPayload;
    // The large fixture has thousands of upcoming renewals; truncated must
    // be large enough to prove we walked past the first page (post-#629:
    // ~4k items hidden by the composite cap). Pre-fix this would be < 10.
    expect(payload.summary.truncated).toBeGreaterThan(100);
    // No silent-truncation warning leaked to stderr.
    expect(result.stderr).not.toMatch(/page limit|results may be incomplete/);
  });

  it("--help mentions the today command + key concepts", async () => {
    const result = await runCliExpectSuccess(["today", "--help"]);
    expect(result.stdout).toContain("today");
    // The morning-brief framing is core to the command's identity.
    expect(result.stdout.toLowerCase()).toMatch(/morning brief|do today/);
    // Help docs the argv contract for agent consumers.
    expect(result.stdout).toContain("args.slice(1)");
  });

  it("is listed in `pax8 --help` (top-level command surface)", async () => {
    const result = await runCliExpectSuccess(["--help"]);
    expect(result.stdout).toContain("today");
  });

  it("--quiet emits nothing on stdout", async () => {
    const result = await runCliExpectSuccess(["today", "--quiet"]);
    expect(result.stdout).toBe("");
  });

  // The `--help` text is the durable agent/human contract surface. Two
  // claims that drifted in earlier rounds — keep them pinned.
  it("--help documents the JSON-vs-human cap distinction and monthlyImpact composition", async () => {
    const result = await runCliExpectSuccess(["today", "--help"]);
    // Cap shape: human renders every section, JSON caps items[] at 10.
    expect(result.stdout).toContain("max 3 per section");
    expect(result.stdout.toLowerCase()).toMatch(/items\[\].*10|10.*composite/);
    // monthlyImpact aggregates urgent renewal MRR + growth uplift —
    // documented so agents don't read it as a single coherent exposure.
    expect(result.stdout.toLowerCase()).toMatch(/urgent.*renewal.*growth.*uplift|renewal.*growth/);
  });
});
