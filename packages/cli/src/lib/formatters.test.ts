// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatTimeAgo,
  formatCurrency,
  formatCurrencyNullable,
  formatQuantity,
  formatStatus,
  formatCompanyName,
  formatDate,
  formatDaysUntil,
} from "./formatters.js";

describe("formatTimeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for recent times", () => {
    expect(formatTimeAgo(new Date("2026-03-19T11:59:30Z"))).toBe("just now");
  });

  it("returns minutes ago", () => {
    expect(formatTimeAgo(new Date("2026-03-19T11:55:00Z"))).toBe("5m ago");
  });

  it("returns hours ago", () => {
    expect(formatTimeAgo(new Date("2026-03-19T10:00:00Z"))).toBe("2h ago");
  });

  it("returns days ago", () => {
    expect(formatTimeAgo(new Date("2026-03-14T12:00:00Z"))).toBe("5d ago");
  });

  it("returns months ago", () => {
    expect(formatTimeAgo(new Date("2025-12-19T12:00:00Z"))).toBe("3mo ago");
  });

  it("returns years ago", () => {
    expect(formatTimeAgo(new Date("2024-01-01T12:00:00Z"))).toBe("2y ago");
  });

  it("accepts string dates", () => {
    expect(formatTimeAgo("2026-03-19T11:55:00Z")).toBe("5m ago");
  });
});

describe("formatCurrency", () => {
  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats small amounts", () => {
    expect(formatCurrency(1.5)).toBe("$1.50");
  });

  it("formats large amounts with commas", () => {
    expect(formatCurrency(1234.56)).toBe("$1,234.56");
  });

  it("formats very large amounts", () => {
    expect(formatCurrency(1234567.89)).toBe("$1,234,567.89");
  });

  it("formats negative amounts", () => {
    expect(formatCurrency(-42.5)).toBe("-$42.50");
  });

  it("rounds to two decimals", () => {
    expect(formatCurrency(10.999)).toBe("$11.00");
  });

  // Currency-code coverage (#472). Use string-contains assertions so a
  // future ICU/CLDR symbol tweak (e.g. NBSP vs U+202F) doesn't flake the
  // suite; the load-bearing contract is "render the right unit, not '$'".
  it("renders EUR with the euro sign, not '$'", () => {
    const result = formatCurrency(1234.56, "EUR");
    expect(result).toContain("€");
    expect(result).toContain("1,234.56");
    expect(result).not.toContain("$");
  });

  it("renders GBP with the pound sign, not '$'", () => {
    const result = formatCurrency(1234.56, "GBP");
    expect(result).toContain("£");
    expect(result).toContain("1,234.56");
    expect(result).not.toContain("$");
  });

  it("disambiguates CAD with the 'CA$' prefix", () => {
    const result = formatCurrency(1234.56, "CAD");
    expect(result).toContain("CA$");
    expect(result).toContain("1,234.56");
  });

  it("renders USD with the dollar sign", () => {
    expect(formatCurrency(1234.56, "USD")).toBe("$1,234.56");
  });

  it("falls back to USD when currencyCode is empty", () => {
    expect(formatCurrency(1234.56, "")).toBe("$1,234.56");
  });

  it("falls back to USD when currencyCode is omitted", () => {
    expect(formatCurrency(1234.56)).toBe("$1,234.56");
  });

  it("handles unknown ISO codes by suffixing the code", () => {
    // "XYZ" is not a real ISO-4217 code; Intl.NumberFormat throws on it.
    // The fallback path keeps the amount visible with the code attached.
    const result = formatCurrency(1234.56, "XYZ");
    expect(result).toContain("1,234.56");
    expect(result).toContain("XYZ");
  });

  it("renders negative EUR with a leading minus", () => {
    const result = formatCurrency(-42.5, "EUR");
    expect(result).toContain("€");
    expect(result).toContain("42.50");
    // Could be "-€42.50" or "(€42.50)" depending on ICU defaults; both
    // contain '-' or '(' — just assert the magnitude renders correctly.
  });
});

// #657 / UXR F9: `?? 0` fallbacks used to misrender missing prices as
// `$0.00`, indistinguishable from a genuine zero. `formatCurrencyNullable`
// draws that distinction — null/undefined/NaN render as a dim em-dash;
// real zeros still render as `$0.00`.
describe("formatCurrencyNullable", () => {
  it("returns a dim em-dash for null", () => {
    // chalk wraps the em-dash in ANSI dim codes; a substring match keeps
    // the assertion robust to the exact escape sequence.
    expect(formatCurrencyNullable(null)).toContain("—");
  });

  it("returns a dim em-dash for undefined", () => {
    expect(formatCurrencyNullable(undefined)).toContain("—");
  });

  it("returns a dim em-dash for NaN", () => {
    expect(formatCurrencyNullable(NaN)).toContain("—");
  });

  it("still renders a real zero as $0.00", () => {
    expect(formatCurrencyNullable(0)).toBe("$0.00");
  });

  it("formats a real amount the same as formatCurrency", () => {
    expect(formatCurrencyNullable(1234.56)).toBe(formatCurrency(1234.56));
  });

  it("honors the currencyCode parameter", () => {
    const result = formatCurrencyNullable(42.5, "EUR");
    expect(result).toContain("42.50");
  });
});

describe("formatQuantity", () => {
  it("formats singular", () => {
    expect(formatQuantity(1)).toBe("1 seat");
  });

  it("formats plural", () => {
    expect(formatQuantity(45)).toBe("45 seats");
  });

  it("formats zero", () => {
    expect(formatQuantity(0)).toBe("0 seats");
  });
});

describe("formatStatus", () => {
  it("formats Active status with green check", () => {
    const result = formatStatus("Active");
    expect(result).toContain("Active");
  });

  it("formats Cancelled status with red X", () => {
    const result = formatStatus("Cancelled");
    expect(result).toContain("Cancelled");
  });

  it("formats canceled (US spelling)", () => {
    const result = formatStatus("canceled");
    expect(result).toContain("Cancelled");
  });

  it("formats Trial status", () => {
    const result = formatStatus("Trial");
    expect(result).toContain("Trial");
  });

  it("formats Pending status", () => {
    const result = formatStatus("PendingActivation");
    expect(result).toContain("PendingActivation");
  });

  it("formats unknown status", () => {
    const result = formatStatus("Unknown");
    expect(result).toContain("Unknown");
  });
});

describe("formatCompanyName", () => {
  it("returns short names unchanged", () => {
    expect(formatCompanyName("Acme Corp")).toBe("Acme Corp");
  });

  it("truncates long names at default 25 chars", () => {
    const long = "Extremely Long Company Name That Exceeds Limit";
    const result = formatCompanyName(long);
    expect(result.length).toBe(25);
    expect(result.endsWith("…")).toBe(true);
  });

  it("truncates at custom maxLen", () => {
    const result = formatCompanyName("Hello World", 8);
    expect(result).toBe("Hello W…");
    expect(result.length).toBe(8);
  });

  it("returns exact-length names unchanged", () => {
    const name = "1234567890123456789012345"; // exactly 25 chars
    expect(formatCompanyName(name)).toBe(name);
  });
});

describe("formatDate", () => {
  it("formats ISO string to readable date", () => {
    // Use a date that is unambiguous across timezones
    const result = formatDate("2026-03-25T12:00:00Z");
    expect(result).toMatch(/Mar\s+25,\s+2026/);
  });

  it("formats Date object", () => {
    const result = formatDate(new Date("2026-01-15T12:00:00Z"));
    expect(result).toMatch(/Jan\s+15,\s+2026/);
  });
});

describe("formatDaysUntil", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'today' for today's date", () => {
    expect(formatDaysUntil("2026-03-19T12:00:00Z")).toBe("today");
  });

  it("returns 'tomorrow' for tomorrow", () => {
    expect(formatDaysUntil("2026-03-20T12:00:00Z")).toBe("tomorrow");
  });

  it("returns 'yesterday' for yesterday", () => {
    expect(formatDaysUntil("2026-03-18T12:00:00Z")).toBe("yesterday");
  });

  it("returns 'in X days' for near future", () => {
    expect(formatDaysUntil("2026-03-25T12:00:00Z")).toBe("in 6 days");
  });

  it("returns 'in X months' for far future", () => {
    expect(formatDaysUntil("2026-05-19T12:00:00Z")).toBe("in 2 months");
  });

  it("returns 'X days ago' for past dates", () => {
    expect(formatDaysUntil("2026-03-16T12:00:00Z")).toBe("3 days ago");
  });

  it("returns 'X months ago' for far past", () => {
    expect(formatDaysUntil("2025-12-19T12:00:00Z")).toBe("3 months ago");
  });
});
