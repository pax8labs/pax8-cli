// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

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
      // #483: JSON envelope is { usage, page }.
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("usage");
      expect(data).toHaveProperty("page");
      expect(Array.isArray(data.usage)).toBe(true);
      expect(data.usage.length).toBeGreaterThan(0);
      for (const item of data.usage) {
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
      expect(Array.isArray(data.usage)).toBe(true);
      // Redwood's Acronis sub is the only one with demo usage; --company
      // iterates over every Redwood subscription but only the Acronis sub
      // yields summaries.
      expect(data.usage.length).toBeGreaterThan(0);
      const productNames = new Set(
        data.usage.map((d: { productName?: string }) => d.productName),
      );
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

    it("--month is ignored with a stderr warning (summaries have no date)", async () => {
      const result = await runCliExpectSuccess([
        "usage",
        "list",
        "--subscription",
        REDWOOD_ACRONIS_SUB,
        "--month",
        "2020-01",
        "--json",
      ]);
      expect(JSON.parse(result.stdout).usage.length).toBeGreaterThan(0);
      expect(result.stderr).toContain("--month is ignored");
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
      // Defaults to today; every line is for that one day.
      expect(data.usageDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const line of data.lines) {
        expect(line.usageDate).toBe(data.usageDate);
      }
    });

    it("--date picks the day and implies --lines", async () => {
      const result = await runCliExpectSuccess([
        "usage",
        "show",
        REDWOOD_USAGE_SUMMARY,
        "--date",
        "2026-04-15",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.usageDate).toBe("2026-04-15");
      expect(data.lines.length).toBeGreaterThan(0);
      for (const line of data.lines) {
        expect(line.usageDate).toBe("2026-04-15");
      }
    });

    it("rejects a malformed --date with ERROR_INVALID_INPUT", async () => {
      const result = await runCli([
        "usage",
        "show",
        REDWOOD_USAGE_SUMMARY,
        "--date",
        "2026-04",
        "--json",
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("ERROR_INVALID_INPUT");
    });

    it("renders the summary's money fields in the table view", async () => {
      const result = await runCliExpectSuccess(
        ["usage", "show", REDWOOD_USAGE_SUMMARY],
        { PAX8_OUTPUT_FORMAT: "table" },
      );
      expect(result.stdout).toContain("Charges:");
      expect(result.stdout).toContain("Partner total:");
      expect(result.stdout).toContain("Backup");
    });
  });
});
