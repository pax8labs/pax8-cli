// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("E2E: Usage workflow — list and show summaries", () => {
  it("pax8 usage list returns JSON when piped", async () => {
    const result = await runCliExpectSuccess(["usage", "list"]);
    // #483: wrapped envelope { usage, page }.
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.usage)).toBe(true);
    expect(data.usage.length).toBeGreaterThan(0);
    const first = data.usage[0];
    // Live wire shape (verified against the real API 2026-11-05).
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("resourceGroup");
    expect(first).toHaveProperty("currentCharges");
    expect(first).toHaveProperty("partnerTotal");
    expect(first).not.toHaveProperty("subtotal");
  });

  it("pax8 usage list --company filters by company name", async () => {
    const result = await runCliExpectSuccess([
      "usage",
      "list",
      "--company",
      "Redwood Manufacturing",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.usage)).toBe(true);
    for (const u of data.usage) {
      expect(u.companyName).toBe("Redwood Manufacturing");
    }
  });

  it("pax8 usage list --month is accepted but ignored, with a warning", async () => {
    // Summaries are current-period rollups with no date, so --month can't
    // filter. It's kept as a no-op so existing scripts don't break.
    const all = await runCliExpectSuccess(["usage", "list", "--json"]);
    const filtered = await runCliExpectSuccess(["usage", "list", "--month", "2020-01", "--json"]);
    expect(JSON.parse(filtered.stdout).usage).toEqual(JSON.parse(all.stdout).usage);
    expect(filtered.stderr).toContain("--month is ignored");
  });

  it("pax8 usage show returns a single summary object", async () => {
    const list = await runCliExpectSuccess(["usage", "list", "--json"]);
    const id = JSON.parse(list.stdout).usage[0].id;

    const result = await runCliExpectSuccess(["usage", "show", id, "--json"]);
    const data = JSON.parse(result.stdout);
    // `show` returns a single object, not an array (#208)
    expect(Array.isArray(data)).toBe(false);
    expect(data.id).toBe(id);
  });

  it("pax8 usage show --lines includes per-resource breakdown", async () => {
    const list = await runCliExpectSuccess(["usage", "list", "--json"]);
    // Pick a summary with known line items
    const summary = JSON.parse(list.stdout).usage.find(
      (u: { id: string }) => u.id === "usage-redwood-acronis-curr",
    );
    expect(summary).toBeDefined();

    const result = await runCliExpectSuccess([
      "usage",
      "show",
      summary.id,
      "--lines",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(false);
    expect(data).toHaveProperty("lines");
    expect(Array.isArray(data.lines)).toBe(true);
    expect(data.lines.length).toBeGreaterThan(0);
    expect(data.lines[0]).toHaveProperty("usageDate", data.usageDate);
    expect(data.lines[0]).toHaveProperty("currentCharges");
    expect(data.lines[0]).not.toHaveProperty("usageSummaryId");
  });

  it("pax8 usage show fails for unknown summary id", async () => {
    const result = await runCliExpectFailure([
      "usage",
      "show",
      "definitely-not-a-real-id",
    ]);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("pax8 usage list --csv includes the expected columns", async () => {
    const result = await runCliExpectSuccess(["usage", "list", "--csv"]);
    const header = result.stdout.split("\n")[0].toLowerCase();
    expect(header).toContain("id");
    expect(header).toContain("charges");
    expect(header).toContain("partner total");
  });

  it("pax8 usage list --ids-only emits one ID per line", async () => {
    const result = await runCliExpectSuccess(["usage", "list", "--ids-only"]);
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // demo IDs have form "usage-..."; live API IDs would be UUIDs.
      // Just verify it's a single non-empty token, no whitespace.
      expect(line).toMatch(/^\S+$/);
    }
  });
});
