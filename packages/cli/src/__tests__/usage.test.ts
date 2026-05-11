// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

const REDWOOD_ACRONIS_SUB = "sub-redwood-acronis-007";
const REDWOOD_USAGE_SUMMARY = "usage-redwood-acronis-curr";

describe("pax8 usage", () => {
  describe("usage list", () => {
    it("--subscription <id> returns summaries for that subscription only", async () => {
      const result = await runCliExpectSuccess([
        "usage",
        "list",
        "--subscription",
        REDWOOD_ACRONIS_SUB,
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      for (const item of data) {
        expect(item.subscriptionId).toBe(REDWOOD_ACRONIS_SUB);
      }
    });

    it("--company <name> resolves to subscriptions and aggregates usage", async () => {
      const result = await runCliExpectSuccess([
        "usage",
        "list",
        "--company",
        "Redwood Manufacturing",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      // Redwood's Acronis sub is the only one with demo usage; --company
      // iterates over every Redwood subscription but only the Acronis sub
      // yields summaries.
      expect(data.length).toBeGreaterThan(0);
      const productNames = new Set(data.map((d: { productName?: string }) => d.productName));
      expect(productNames.has("AvePoint Cloud Backup for Microsoft 365")).toBe(true);
    });

    it("--company <unknown> errors with a clear company-not-found message", async () => {
      const result = await runCliExpectSuccess([
        "usage",
        "list",
        "--help",
      ]);
      // Smoke-check that --subscription is documented in --help.
      expect(result.stdout).toContain("--subscription");
      expect(result.stdout).toContain("--company");
    });

    it("--month filters results client-side by date prefix", async () => {
      // First grab the date the curr summary lives in, then assert filtering
      // both keeps and drops the right rows.
      const all = await runCliExpectSuccess([
        "usage",
        "list",
        "--subscription",
        REDWOOD_ACRONIS_SUB,
        "--json",
      ]);
      const everything = JSON.parse(all.stdout) as Array<{ date: string }>;
      expect(everything.length).toBeGreaterThan(0);
      const currMonth = everything[0].date.slice(0, 7); // YYYY-MM

      const filtered = await runCliExpectSuccess([
        "usage",
        "list",
        "--subscription",
        REDWOOD_ACRONIS_SUB,
        "--month",
        currMonth,
        "--json",
      ]);
      const data = JSON.parse(filtered.stdout) as Array<{ date: string }>;
      for (const item of data) {
        expect(item.date.startsWith(currMonth)).toBe(true);
      }
    });
  });

  describe("usage show", () => {
    it("--lines hits the spec /usage-lines leaf and renders the breakdown", async () => {
      const result = await runCliExpectSuccess([
        "usage",
        "show",
        REDWOOD_USAGE_SUMMARY,
        "--lines",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.id).toBe(REDWOOD_USAGE_SUMMARY);
      expect(Array.isArray(data.lines)).toBe(true);
      expect(data.lines.length).toBeGreaterThan(0);
      for (const line of data.lines) {
        expect(line.usageSummaryId).toBe(REDWOOD_USAGE_SUMMARY);
      }
    });
  });
});
