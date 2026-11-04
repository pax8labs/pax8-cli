// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { levenshtein, suggest } from "./fuzzy.js";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  it("returns the length of the non-empty string when one is empty", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abcd", "")).toBe(4);
  });

  it("counts a single insertion", () => {
    expect(levenshtein("abc", "abcd")).toBe(1);
    expect(levenshtein("abc", "abxc")).toBe(1);
  });

  it("counts a single deletion", () => {
    expect(levenshtein("abcd", "abc")).toBe(1);
    expect(levenshtein("abxc", "abc")).toBe(1);
  });

  it("counts a single substitution", () => {
    expect(levenshtein("abc", "aXc")).toBe(1);
  });

  it("is case-sensitive at the function level", () => {
    expect(levenshtein("abc", "ABC")).toBe(3);
  });

  it("computes the classic kitten/sitting distance = 3", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});

describe("suggest", () => {
  const CANDIDATES = [
    "seat-gap",
    "cross-sell",
    "upsell",
    "add-on",
    "opportunity-type",
    "mrr-uplift",
    "orderable",
    "commitment-term",
    "billing-term",
    "priority",
  ];

  it("returns close matches, sorted by distance", () => {
    // 'xross-sell' → 'cross-sell' is the obvious neighbor (distance 1).
    // 'add-on' at distance 8+ is outside the default threshold.
    expect(suggest("xross-sell", CANDIDATES)).toEqual(["cross-sell"]);
  });

  it("returns empty when nothing is close enough", () => {
    expect(suggest("zzzzzzzzz", CANDIDATES)).toEqual([]);
  });

  it("respects the max cap", () => {
    // Very high threshold to force many matches, then cap at 2.
    const result = suggest("seat", CANDIDATES, { max: 2, threshold: 10 });
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("orders ties alphabetically for stable output", () => {
    // Two candidates at the same distance from the needle should be
    // ordered lexicographically. `foo-a` and `foo-b` are both distance
    // 1 from `foo`.
    const tied = suggest("foo", ["foo-b", "foo-a"], { threshold: 3 });
    expect(tied).toEqual(["foo-a", "foo-b"]);
  });

  it("lower-cases before comparing so typos in the wrong case still match", () => {
    expect(suggest("Cross-Sell", CANDIDATES, { threshold: 0 })).toEqual([
      "cross-sell",
    ]);
  });

  it("tighter default threshold on short inputs prevents spam", () => {
    // Default threshold for "cs" (length 2) is floor(2*0.4)=0. Nothing
    // should match a 2-char input with zero distance.
    expect(suggest("cs", CANDIDATES)).toEqual([]);
  });
});
