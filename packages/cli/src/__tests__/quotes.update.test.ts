// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import {
  runCliExpectSuccess,
  runCliWithInput,
} from "./test-utils.js";

// Demo-data fixtures the tests rely on:
//   quote-summit-001 — 2 line items (multi-line, triggers destructive warning)
//   quote-bright-001 — 1 line item (single-line, terser confirm)
// Both expose `lineItems[].productId` so we can drive the diff path without
// touching the live API.

describe("pax8 quotes update", () => {
  describe("destructive replace warning", () => {
    it("shows REPLACES + DESTROYS language when collapsing a multi-line quote", async () => {
      // Decline at the prompt so the write is not actually attempted; we are
      // only asserting on the diff that gets printed before the question.
      const result = await runCliWithInput(
        [
          "quotes",
          "update",
          "quote-summit-001",
          "--product",
          "Microsoft 365 E3",
          "--quantity",
          "10",
          "--billing-term",
          "Annual",
        ],
        "n\n",
      );

      // The diff itself.
      expect(result.stderr).toContain("Current line items (will be REPLACED):");
      expect(result.stderr).toContain("New line items:");

      // The bright-red footer that names the cost. We don't lock the exact
      // count so the test stays robust if demo data is rebalanced — but we
      // do require partners to see they're losing data.
      expect(result.stderr).toMatch(/DESTROYS \d+ existing line items/);

      // The user typed "n", so the command should report cancellation and
      // exit 0 (cancelled-by-user is not an error).
      expect(result.stderr).toMatch(/Cancelled/);
      expect(result.exitCode).toBe(0);
    });

    it("default answer is NO for the destructive-replace prompt", async () => {
      // Send empty input (just EOF). Default for the destructive prompt is
      // false, so the command must NOT fall through to the write.
      const result = await runCliWithInput(
        [
          "quotes",
          "update",
          "quote-summit-001",
          "--product",
          "Microsoft 365 E3",
          "--quantity",
          "10",
        ],
        "\n",
      );

      expect(result.stderr).toMatch(/Cancelled/);
      // Should NOT have proceeded to update.
      expect(result.stderr).not.toMatch(/Quote updated/);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("--yes bypass", () => {
    it("skips the prompt and applies the change", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "update",
        "quote-summit-001",
        "--product",
        "Microsoft 365 E3",
        "--quantity",
        "10",
        "--billing-term",
        "Annual",
        "--yes",
      ]);

      // Diff still rendered (transparency), but no prompt blocked us and the
      // update completed.
      expect(result.stderr).toContain("Quote updated");
    });
  });

  describe("expiration-only fast path", () => {
    it("does not show the destructive warning when only --expiration-date is set", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "update",
        "quote-summit-001",
        "--expiration-date",
        "2026-06-15",
        "--yes",
      ]);

      // The destructive language must not appear when no line-item replace
      // is happening.
      expect(result.stderr).not.toMatch(/DESTROYS/);
      expect(result.stderr).not.toMatch(/will be REPLACED/);
      // But the fast-path still confirmed the date change and updated.
      expect(result.stderr).toContain("New expiration:");
      expect(result.stderr).toContain("2026-06-15");
      expect(result.stderr).toContain("Quote updated");
    });
  });

  describe("single-line quote", () => {
    it("uses the terser confirm (no destructive warning)", async () => {
      // quote-acme-001 has exactly one line item — the terser-confirm path
      // only fires when new-count matches existing-count. Uses Acme Corp
      // because the other Draft demo quote (quote-bright-001) has two.
      const result = await runCliExpectSuccess([
        "quotes",
        "update",
        "quote-acme-001",
        "--product",
        "Microsoft 365 E3",
        "--quantity",
        "20",
        "--yes",
      ]);

      // Single-item replace is still a write that gets confirmed, but it
      // should NOT use the loud destructive language reserved for 2+ items.
      expect(result.stderr).not.toMatch(/DESTROYS/);
      expect(result.stderr).not.toMatch(/Current line items \(will be REPLACED\):/);
      expect(result.stderr).toContain("Quote updated");
    });
  });

  describe("update --help", () => {
    it("documents the destructive-replace caveat", async () => {
      const result = await runCliExpectSuccess(["quotes", "update", "--help"]);
      // Help text should warn partners up front so the surprise is gone
      // even before they run the command.
      expect(result.stdout).toMatch(/replaces ALL existing line items/);
    });
  });
});
