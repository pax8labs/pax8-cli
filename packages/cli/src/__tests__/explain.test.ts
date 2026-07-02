// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

// Force table mode where we assert on the human render. Without this,
// the subprocess sees a non-TTY stdout and getOutputFormat() falls back
// to JSON.
const TABLE = { PAX8_OUTPUT_FORMAT: "table" as const };

describe("pax8 explain", () => {
  describe("basic lookup", () => {
    it("renders the canonical entry for a known term (text mode)", async () => {
      const result = await runCliExpectSuccess(["explain", "seat-gap"], TABLE);
      expect(result.stdout).toContain("seat gap");
      expect(result.stdout).toMatch(/cross-product seat mismatch/i);
      // Metadata block
      expect(result.stdout).toContain("Category:");
      expect(result.stdout).toContain("Recommendations");
      // See also lists cross-sell somewhere
      expect(result.stdout).toContain("cross-sell");
    });

    it("emits a --json envelope with the expected fields", async () => {
      const result = await runCliExpectSuccess(["explain", "seat-gap", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(data.term).toBe("seat-gap");
      expect(data.category).toBe("recommendation");
      expect(typeof data.short).toBe("string");
      expect(data.short.length).toBeGreaterThan(0);
      expect(Array.isArray(data.seeAlso)).toBe(true);
      expect(data.seeAlso).toContain("cross-sell");
    });

    it("under a piped (non-TTY) stdout defaults to JSON without --json", async () => {
      const result = await runCliExpectSuccess(["explain", "seat-gap"]);
      const data = JSON.parse(result.stdout);
      expect(data.term).toBe("seat-gap");
    });
  });

  describe("normalization and aliases", () => {
    it("accepts spaces via variadic args (\"opportunity type\")", async () => {
      const result = await runCliExpectSuccess(
        ["explain", "opportunity", "type", "--json"],
      );
      const data = JSON.parse(result.stdout);
      expect(data.term).toBe("opportunity-type");
    });

    it("accepts an alias declared in the glossary (\"mismatched seats\")", async () => {
      const result = await runCliExpectSuccess(
        ["explain", "mismatched", "seats", "--json"],
      );
      const data = JSON.parse(result.stdout);
      // "mismatched seats" is an alias for seat-gap.
      expect(data.term).toBe("seat-gap");
    });

    it("resolves underscore-style input to the kebab-case canonical", async () => {
      const result = await runCliExpectSuccess(["explain", "seat_gap", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(data.term).toBe("seat-gap");
    });

    it("is case-insensitive", async () => {
      const result = await runCliExpectSuccess(["explain", "SEAT-GAP", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(data.term).toBe("seat-gap");
    });
  });

  describe("--list", () => {
    it("lists every canonical term in the glossary (JSON)", async () => {
      const result = await runCliExpectSuccess(["explain", "--list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data.terms)).toBe(true);
      // Pin the v1 size loosely — 15 terms today, may grow in follow-ups.
      // The tight assertion is that every entry has the required shape.
      expect(data.terms.length).toBeGreaterThanOrEqual(15);
      for (const t of data.terms) {
        expect(typeof t.term).toBe("string");
        expect(typeof t.category).toBe("string");
        expect(typeof t.short).toBe("string");
      }
      // A few anchor terms must be present
      const slugs = data.terms.map((t: { term: string }) => t.term);
      expect(slugs).toContain("seat-gap");
      expect(slugs).toContain("cross-sell");
      expect(slugs).toContain("mrr-uplift");
    });

    it("renders a grouped listing in text mode", async () => {
      const result = await runCliExpectSuccess(["explain", "--list"], TABLE);
      expect(result.stdout).toContain("Pax8 CLI glossary");
      expect(result.stdout).toContain("Recommendations");
      // At least one representative term from each major category
      expect(result.stdout).toContain("seat-gap");
      expect(result.stdout).toContain("billing-term");
    });
  });

  describe("term-not-found", () => {
    it("exits 1 and suggests a nearby term on a typo", async () => {
      const result = await runCliExpectFailure(
        ["explain", "xross-sell"],
        TABLE,
      );
      // The nearest-match hint lands on stderr per the CliError envelope.
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/cross-sell/);
      expect(combined.toLowerCase()).toContain("no glossary entry");
    });

    it("carries ERROR_TERM_NOT_FOUND in the --json envelope", async () => {
      const result = await runCliExpectFailure(
        ["explain", "xross-sell", "--json"],
      );
      // The envelope is a JSON object on stderr — same shape as the
      // company-not-found path pinned in error-codes.test.ts.
      const start = result.stderr.indexOf("{");
      expect(start).toBeGreaterThanOrEqual(0);
      const json = JSON.parse(result.stderr.slice(start));
      expect(json.code).toBe("ERROR_TERM_NOT_FOUND");
      // The suggestion appears in causes, not in the (redactor-sanitized)
      // message.
      expect(json.causes.join(" ")).toContain("cross-sell");
    });
  });

  describe("input validation", () => {
    it("rejects --list combined with a positional term", async () => {
      const result = await runCliExpectFailure(
        ["explain", "--list", "seat-gap"],
        TABLE,
      );
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toContain("mutually exclusive");
    });

    it("rejects no args and no --list", async () => {
      const result = await runCliExpectFailure(["explain"], TABLE);
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toContain("missing term");
    });
  });

  describe("help", () => {
    it("shows the command and its --list flag", async () => {
      const result = await runCliExpectSuccess(["explain", "--help"]);
      expect(result.stdout).toContain("explain");
      expect(result.stdout).toContain("--list");
    });

    it("is registered on the top-level program", async () => {
      const result = await runCliExpectSuccess(["--help"]);
      expect(result.stdout).toContain("explain");
    });
  });

  describe("glossary integrity", () => {
    // Startup-contract asserts that would fire at import time — verified
    // here by importing the module in-process and checking invariants.
    it("every seeAlso reference resolves to a canonical entry", async () => {
      const { GLOSSARY, lookupTerm } = await import("../commands/explain-glossary.js");
      for (const entry of GLOSSARY) {
        for (const ref of entry.seeAlso ?? []) {
          expect(
            lookupTerm(ref),
            `${entry.term}.seeAlso includes "${ref}", which has no glossary entry`,
          ).toBeDefined();
        }
      }
    });

    it("every canonical slug is lowercase kebab-case", async () => {
      const { GLOSSARY } = await import("../commands/explain-glossary.js");
      for (const entry of GLOSSARY) {
        expect(entry.term).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });
  });
});
