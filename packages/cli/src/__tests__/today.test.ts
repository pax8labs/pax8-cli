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
});
