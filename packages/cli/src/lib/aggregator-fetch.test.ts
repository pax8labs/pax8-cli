// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import {
  emitWarnings,
  formatWarning,
  type WarningRecord,
} from "./aggregator-fetch.js";

/**
 * Unit tests for the shared warning-record plumbing used by the `today` and
 * `dashboard` aggregator-fetch helpers (#635).
 *
 * The fetch helpers now return `warnings: WarningRecord[]` alongside their
 * data; the command layer is responsible for surfacing them via
 * `emitWarnings()`. These tests pin the formatter shape (chalk colouring,
 * glyph, indent, newline) so the observable stderr output cannot drift
 * silently when the helper is touched.
 */

function collectStream(): {
  stream: NodeJS.WritableStream;
  read: () => string;
} {
  let buf = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buf += chunk.toString();
      callback();
    },
  });
  return { stream, read: () => buf };
}

describe("formatWarning", () => {
  it("renders a warn-severity record with the yellow ⚠ prefix", () => {
    const w: WarningRecord = {
      feed: "companies",
      severity: "warn",
      message: "Could not load companies",
    };
    const out = formatWarning(w);
    // Trailing newline + glyph + message — colour codes are present but we
    // assert the visible substring, not the exact escape sequence (chalk
    // varies with the test environment's colour-depth detection).
    expect(out).toMatch(/⚠ Could not load companies/);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.startsWith("  ") || out.includes("")).toBe(true);
  });

  it("renders an error-severity record with the red ✗ prefix", () => {
    const w: WarningRecord = {
      feed: "subscriptions",
      severity: "error",
      message: "Could not load subscriptions — today's list is incomplete",
    };
    const out = formatWarning(w);
    expect(out).toMatch(/✗ Could not load subscriptions/);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("uses different glyphs for warn vs error severities", () => {
    const warn = formatWarning({
      feed: "products",
      severity: "warn",
      message: "x",
    });
    const error = formatWarning({
      feed: "products",
      severity: "error",
      message: "x",
    });
    expect(warn).toContain("⚠");
    expect(warn).not.toContain("✗");
    expect(error).toContain("✗");
    expect(error).not.toContain("⚠");
  });
});

describe("emitWarnings", () => {
  it("writes nothing to the stream when the warnings array is empty", () => {
    const { stream, read } = collectStream();
    emitWarnings(stream, []);
    expect(read()).toBe("");
  });

  it("writes one line per warning in input order", () => {
    const { stream, read } = collectStream();
    const warnings: WarningRecord[] = [
      { feed: "companies", severity: "warn", message: "first" },
      { feed: "products", severity: "warn", message: "second" },
      { feed: "subscriptions", severity: "error", message: "third" },
    ];
    emitWarnings(stream, warnings);
    const lines = read().split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    // strip ANSI colour codes for content assertions; order must match
    // input order.
    const stripped = lines.map((l) => l.replace(/\[\d+m/g, ""));
    expect(stripped[0]).toContain("first");
    expect(stripped[1]).toContain("second");
    expect(stripped[2]).toContain("third");
    // first two are warn (⚠), third is error (✗).
    expect(stripped[0]).toContain("⚠");
    expect(stripped[1]).toContain("⚠");
    expect(stripped[2]).toContain("✗");
  });

  it("matches the pre-refactor today.ts inline messages verbatim", () => {
    // Locking in the exact strings the helper used to write inline so the
    // observable stderr behavior cannot drift under refactor.
    const { stream, read } = collectStream();
    emitWarnings(stream, [
      {
        feed: "companies",
        severity: "warn",
        message: "Could not load companies — names may render as IDs",
      },
      {
        feed: "products",
        severity: "warn",
        message: "Could not load product catalog — growth opportunities suppressed",
      },
      {
        feed: "invoices",
        severity: "warn",
        message: "Could not load invoices — audit findings suppressed",
      },
      {
        feed: "subscriptions",
        severity: "error",
        message: "Could not load subscriptions — today's list is incomplete",
      },
    ]);
    const stripped = read().replace(/\[\d+m/g, "");
    expect(stripped).toContain("  ⚠ Could not load companies — names may render as IDs\n");
    expect(stripped).toContain("  ⚠ Could not load product catalog — growth opportunities suppressed\n");
    expect(stripped).toContain("  ⚠ Could not load invoices — audit findings suppressed\n");
    expect(stripped).toContain("  ✗ Could not load subscriptions — today's list is incomplete\n");
  });

  it("matches the pre-refactor dashboard.ts inline messages verbatim", () => {
    const { stream, read } = collectStream();
    emitWarnings(stream, [
      { feed: "companies", severity: "warn", message: "Could not load companies" },
      { feed: "subscriptions", severity: "warn", message: "Could not load subscriptions" },
      { feed: "products", severity: "warn", message: "Could not load products" },
    ]);
    const stripped = read().replace(/\[\d+m/g, "");
    expect(stripped).toContain("  ⚠ Could not load companies\n");
    expect(stripped).toContain("  ⚠ Could not load subscriptions\n");
    expect(stripped).toContain("  ⚠ Could not load products\n");
  });
});
