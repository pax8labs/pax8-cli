// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Verifies the "JSON output (--json):" sections added to addHelpText("after")
 * on commands with nested/computed response shapes (#396 — widened scope from
 * the partner walkthrough). Partners parsing `--json` need the contract
 * pinned in --help so they don't have to run the command to discover the shape.
 *
 * No code logic changes — pure docs/help-text. We assert the section header
 * appears AND that specific load-bearing field names are mentioned.
 */

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("JSON output shape documented in --help (#396)", () => {
  describe("pax8 cost sim --help", () => {
    it("documents the simulation result shape", async () => {
      const { stdout } = await runCliExpectSuccess(["cost", "sim", "--help"]);
      expect(stdout).toContain("JSON output");
      // Key top-level fields
      expect(stdout).toContain("companyName");
      expect(stdout).toContain("current");
      expect(stdout).toContain("proposed");
      expect(stdout).toContain("delta");
      expect(stdout).toContain("nextActions");
    });
  });

  describe("pax8 dashboard --help", () => {
    it("documents the multi-section snapshot shape", async () => {
      const { stdout } = await runCliExpectSuccess(["dashboard", "--help"]);
      expect(stdout).toContain("JSON output");
      expect(stdout).toContain("topCustomers");
      expect(stdout).toContain("renewals");
      expect(stdout).toContain("mrrRenewing");
      // Pax8-cost figures use the canonical wrapped AmountCurrency envelope.
      expect(stdout).toContain("monthlyCost");
      expect(stdout).toContain("annualCost");
      expect(stdout).toContain("AmountCurrency");
      expect(stdout).toContain("createdAt");
    });
  });

  describe("pax8 recommendations list --help", () => {
    it("documents the Recommendation shape and STAX divergence", async () => {
      const { stdout } = await runCliExpectSuccess([
        "recommendations",
        "list",
        "--help",
      ]);
      expect(stdout).toContain("JSON output");
      expect(stdout).toContain("orderCommand");
      expect(stdout).toContain("estimatedMrrUplift");
      expect(stdout).toContain("opportunityType");
      // STAX divergence cross-link
      expect(stdout).toContain("STAX");
    });
  });

  describe("pax8 invoices audit --help", () => {
    it("documents the discrepancy array shape", async () => {
      const { stdout } = await runCliExpectSuccess([
        "invoices",
        "audit",
        "--help",
      ]);
      expect(stdout).toContain("JSON output");
      expect(stdout).toContain("discrepancies");
      expect(stdout).toContain("discrepancyId");
      expect(stdout).toContain("dollarImpact");
      expect(stdout).toContain("netImpact");
    });
  });

  describe("pax8 subscriptions renewals --help", () => {
    it("documents canonical renewal field names", async () => {
      const { stdout } = await runCliExpectSuccess([
        "subscriptions",
        "renewals",
        "--help",
      ]);
      expect(stdout).toContain("JSON output");
      // Canonical fields (#298)
      expect(stdout).toContain("mrrRenewing");
      expect(stdout).toContain("arrRenewing");
    });
  });

  // The `pax8 report mrr` / `pax8 report growth` --help blocks were
  // removed when those commands themselves were removed — they were
  // framed as partner-side MRR / growth but actually surfaced Pax8 cost
  // to the partner. The underlying analytics in @pax8/core
  // (`computeMrr`, `computeGrowth`) are preserved for v0.2 reporting
  // work that will reframe the vocabulary correctly.

  // The standardized "Pax8 cost" disclaimer footer (added in the
  // AmountCurrency reshape revision) must appear verbatim on every
  // command that surfaces partner-side Pax8 cost numbers, so partners
  // reading help across commands see identical framing. Same exact
  // string will land on the three new reporting commands when they
  // ship in the follow-on reshape PR.
  describe("standardized Pax8-cost disclaimer footer", () => {
    const DISCLAIMER =
      /Numbers shown are Pax8 cost — what Pax8 charges you\. For partner revenue \(what you charge your customers\), combine with sell-through pricing from your PSA\./;
    const COMMANDS: Array<[string, string[]]> = [
      ["pax8 dashboard", ["dashboard", "--help"]],
      ["pax8 recommendations list", ["recommendations", "list", "--help"]],
      ["pax8 recommendations act", ["recommendations", "act", "--help"]],
      ["pax8 recommendations upsell", ["recommendations", "upsell", "--help"]],
      ["pax8 subscriptions renewals", ["subscriptions", "renewals", "--help"]],
      ["pax8 clients more", ["clients", "more", "--help"]],
    ];

    for (const [label, argv] of COMMANDS) {
      it(`appears on ${label} --help`, async () => {
        const { stdout } = await runCliExpectSuccess(argv);
        expect(stdout).toMatch(DISCLAIMER);
      });
    }
  });
});
