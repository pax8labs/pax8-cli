// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

// Scale-matrix subprocess tests (#484 follow-up).
//
// Runs the read surface of the CLI against the large-portfolio fixture
// (`PAX8_DEMO_SCALE=large` — 1,000 companies, 5,000 subscriptions,
// 45,000 orders, mixed currencies, hostile-named companies, every
// BillingTerm value).
//
// What this file does NOT do: assert that the launch-blocker bugs are
// fixed. Each blocker fix (#462 shell injection, #465 MRR math, #472
// currency, #478 orders list, #483 list-rollout) lands its own
// strong assertion in this file. Today the suite verifies only the
// bare minimum invariants any command should respect under scale —
// exits 0, produces valid JSON, returns non-empty data where data
// should exist, doesn't crash on hostile customer names.
//
// Treat each `it.todo("blocker: ...")` as a placeholder for the
// regression assertion that should be wired up alongside the matching
// blocker PR. Don't move a `.todo` to a regular `it()` unless the
// matching blocker has actually shipped — that's the gate.

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

// Helper: every test in this file routes through the large fixture.
const LARGE: Record<string, string> = { PAX8_DEMO_SCALE: "large" };

// Helper: parse `--json` output, surfacing the raw stdout on failure
// so a CI red gives us context instead of "Unexpected token in JSON".
function parseJson<T = unknown>(stdout: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse CLI JSON output. First 500 chars:\n${stdout.slice(0, 500)}\n\nOriginal error: ${err}`,
      { cause: err },
    );
  }
}

describe("scale matrix — read surface under PAX8_DEMO_SCALE=large", () => {
  describe("invariants on the fixture itself", () => {
    // Sanity check: confirm the env-var routing actually swaps in the
    // generated fixture. If this one ever fails, every other test below
    // is moot — investigate `packages/core/src/mock/fixture.ts` first.
    it("clients list returns >= 200 companies (small fixture has < 50)", async () => {
      const result = await runCliExpectSuccess(
        ["clients", "list", "--json", "--size", "1000"],
        LARGE,
      );
      // #483: wrapped envelope { companies, page }.
      const data = parseJson<{ companies: unknown[]; page: { totalElements: number } }>(
        result.stdout,
      );
      expect(Array.isArray(data.companies)).toBe(true);
      expect(data.companies.length).toBeGreaterThan(200);
      expect(data.page.totalElements).toBeGreaterThan(200);
    });

    it("subscriptions list fills a 1000-row page (small fixture caps out at dozens)", async () => {
      // #483: every list command emits `{ <resource>, page }`. We can now
      // verify the total via `data.page.totalElements`.
      const result = await runCliExpectSuccess(
        ["subscriptions", "list", "--json", "--size", "1000"],
        LARGE,
      );
      const data = parseJson<{ subscriptions: unknown[]; page: { totalElements: number } }>(
        result.stdout,
      );
      expect(data.subscriptions.length).toBeGreaterThanOrEqual(1000);
      expect(data.page.totalElements).toBeGreaterThanOrEqual(5000);
    });
  });

  describe("non-crash matrix — every read command exits 0", () => {
    // Minimum bar: each documented read command runs to completion
    // against the large fixture and emits well-formed JSON.

    it("pax8 dashboard --json", async () => {
      const result = await runCliExpectSuccess(["dashboard", "--json"], LARGE);
      const data = parseJson<Record<string, unknown>>(result.stdout);
      expect(data).toHaveProperty("monthlyCost");
      expect(data).toHaveProperty("topCustomers");
    });

    it("pax8 clients list --json", async () => {
      const result = await runCliExpectSuccess(["clients", "list", "--json"], LARGE);
      const data = parseJson<{ companies: unknown[] }>(result.stdout);
      expect(Array.isArray(data.companies)).toBe(true);
      expect(data.companies.length).toBeGreaterThan(0);
    });

    it("pax8 subscriptions list --json", async () => {
      const result = await runCliExpectSuccess(["subscriptions", "list", "--json"], LARGE);
      const data = parseJson<{ subscriptions: unknown[] }>(result.stdout);
      expect(Array.isArray(data.subscriptions)).toBe(true);
      expect(data.subscriptions.length).toBeGreaterThan(0);
    });

    it("pax8 subscriptions renewals --json", async () => {
      const result = await runCliExpectSuccess(
        ["subscriptions", "renewals", "--json", "--within", "30d"],
        LARGE,
      );
      // Renewals is a wrapped envelope with `items` and metadata; allow either
      // an array or an envelope shape here — the strong-shape assertion lands
      // with the renewals-side blocker fix.
      const data = parseJson<unknown>(result.stdout);
      expect(data).toBeDefined();
    });

    it("pax8 orders list --json", async () => {
      // #478: orders list --json is now wrapped { orders, page } so agents
      // can see the totalElements / totalPages without a separate call.
      const result = await runCliExpectSuccess(["orders", "list", "--json"], LARGE);
      const data = parseJson<{ orders: unknown[]; page: { totalElements: number } }>(
        result.stdout,
      );
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBeGreaterThan(0);
      expect(data.page.totalElements).toBeGreaterThan(0);
    });

    it("pax8 products search --json", async () => {
      // Search a vendor that exists in the large-fixture corpus.
      const result = await runCliExpectSuccess(
        ["products", "search", "Microsoft", "--json"],
        LARGE,
      );
      const data = parseJson<unknown>(result.stdout);
      expect(data).toBeDefined();
    });

    it("pax8 recommendations list --json", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json"], LARGE);
      // #521: list output is now an envelope { recommendations, totalAvailable }
      // even without --with-actions. Default cap is 10; under the large
      // fixture totalAvailable should be substantially larger.
      const data = parseJson<{ recommendations: unknown[]; totalAvailable: number }>(result.stdout);
      expect(Array.isArray(data.recommendations)).toBe(true);
      expect(data.recommendations.length).toBeLessThanOrEqual(10);
      expect(typeof data.totalAvailable).toBe("number");
      expect(data.totalAvailable).toBeGreaterThanOrEqual(data.recommendations.length);
    });

    it("pax8 doctor (non-crash; --json shape contract verified separately in #470)", async () => {
      // doctor's --json contract is broken today (#470). Until that lands we
      // assert only that the command exits cleanly under the large fixture.
      const result = await runCliExpectSuccess(["doctor"], LARGE);
      expect(result.exitCode).toBe(0);
    });

    // Entity types not yet populated in the large fixture return empty
    // arrays — that's a fixture limitation documented in #484, not a bug.
    // Assert non-crash + empty-OK.

    it("pax8 invoices list --json (empty under large fixture today)", async () => {
      const result = await runCliExpectSuccess(["invoices", "list", "--json"], LARGE);
      const data = parseJson<{ invoices: unknown[] }>(result.stdout);
      expect(Array.isArray(data.invoices)).toBe(true);
    });

    it("pax8 webhooks list --json (empty under large fixture today)", async () => {
      const result = await runCliExpectSuccess(["webhooks", "list", "--json"], LARGE);
      const data = parseJson<{ webhooks: unknown[] }>(result.stdout);
      expect(Array.isArray(data.webhooks)).toBe(true);
    });
  });

  describe("#518 — list commands clamp --size to LIST_SIZE_CAP (1000)", () => {
    // Issue #518: list commands previously honored arbitrarily-large
    // `--size` values (`orders list --size 50000` returned ~34 MB of
    // JSON). The fix caps every list command at the LIST_SIZE_CAP
    // (1000) ceiling and emits a stderr warning when clamping.

    it("orders list --size 50000 returns at most LIST_SIZE_CAP rows", async () => {
      const result = await runCliExpectSuccess(
        ["orders", "list", "--json", "--size", "50000"],
        LARGE,
      );
      // #478: wrapped envelope { orders, page }.
      const data = parseJson<{ orders: unknown[] }>(result.stdout);
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBeLessThanOrEqual(1000);
    });

    it("orders list --size 50000 emits the clamp warning on stderr", async () => {
      const result = await runCliExpectSuccess(
        ["orders", "list", "--json", "--size", "50000"],
        LARGE,
      );
      expect(result.stderr).toContain("--size 50000 clamped to 1000");
    });

    it("subscriptions list --size 5000 caps at LIST_SIZE_CAP rows", async () => {
      const result = await runCliExpectSuccess(
        ["subscriptions", "list", "--json", "--size", "5000"],
        LARGE,
      );
      const data = parseJson<{ subscriptions: unknown[] }>(result.stdout);
      expect(Array.isArray(data.subscriptions)).toBe(true);
      expect(data.subscriptions.length).toBeLessThanOrEqual(1000);
      expect(result.stderr).toContain("--size 5000 clamped to 1000");
    });

    it("clients list --size 10000 caps and warns", async () => {
      const result = await runCliExpectSuccess(
        ["clients", "list", "--json", "--size", "10000"],
        LARGE,
      );
      const data = parseJson<{ companies: unknown[] }>(result.stdout);
      expect(Array.isArray(data.companies)).toBe(true);
      expect(data.companies.length).toBeLessThanOrEqual(1000);
      expect(result.stderr).toContain("--size 10000 clamped to 1000");
    });

    it("a sub-cap --size value does NOT emit the warning", async () => {
      // Regression guard: clamp + warn must only fire above LIST_SIZE_CAP.
      const result = await runCliExpectSuccess(
        ["orders", "list", "--json", "--size", "500"],
        LARGE,
      );
      expect(result.stderr).not.toContain("clamped to 1000");
    });

    it("exactly LIST_SIZE_CAP does NOT emit the warning (boundary)", async () => {
      const result = await runCliExpectSuccess(
        ["orders", "list", "--json", "--size", "1000"],
        LARGE,
      );
      expect(result.stderr).not.toContain("clamped to 1000");
    });
  });

  describe("hostile-name robustness", () => {
    // The large fixture seeds 12 deliberately-hostile customer names
    // (shell-meta, Unicode, embedded quotes/backticks/newlines). The
    // CLI should serialize/render them without crashing or producing
    // invalid JSON. This guards against future regressions where a
    // contributor adds a code path that assumes alphanumeric-only
    // names.

    it("clients list --json with hostile names round-trips through JSON", async () => {
      const result = await runCliExpectSuccess(
        ["clients", "list", "--json", "--size", "1000"],
        LARGE,
      );
      // Just parsing successfully is the assertion — a crash or invalid
      // escape would throw above.
      const data = parseJson<{ companies: Array<{ name: string }> }>(result.stdout);
      // At least one of the hostile names should appear.
      const hasHostile = data.companies.some(
        (c) => c.name.includes('"') || c.name.includes("'") || c.name.includes("北京"),
      );
      expect(hasHostile).toBe(true);
    });

    it("subscriptions list --json renders hostile company names without crashing", async () => {
      const result = await runCliExpectSuccess(
        ["subscriptions", "list", "--json", "--size", "1000"],
        LARGE,
      );
      const data = parseJson<{ subscriptions: unknown[] }>(result.stdout);
      expect(data.subscriptions.length).toBeGreaterThan(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Placeholders for the per-blocker assertions. Move each `.todo` to a
  // real `it()` ONLY when the matching blocker PR ships, and have that
  // PR add the strong assertion here. This file is the regression gate
  // for everything below — it should never get smaller.
  // ──────────────────────────────────────────────────────────────────────

  describe("blocker regressions (assertion lands with each fix)", () => {
    it.todo(
      "#462 — orderCommand strings from recommendations list are safe to exec: " +
        "for a hostile-named customer, the rendered command must not produce " +
        "subshell substitution when parsed by a real shell",
    );

    it.todo(
      "#465 — subscriptionMrr returns 0 for One-Time/Trial/Activation: " +
        "dashboard monthlyCost should not include gross from a $5000 One-Time fee",
    );

    it.todo(
      "#472 — formatCurrency renders the correct unit per row: " +
        "non-USD subs in `subscriptions list` show €/£/C$ rather than $",
    );

    it.todo(
      "#478 — orders list exposes pagination metadata: " +
        "JSON envelope includes page.{number,size,totalElements,totalPages}; " +
        "default sort is createdAt DESC; companies beyond size:200 still resolve",
    );

    it.todo(
      "#483 — every list command exposes the same page envelope: " +
        "applies the #478 contract across subscriptions / clients / invoices / " +
        "quotes / contacts / webhooks / products lists",
    );

    it.todo(
      "#469 — last-list / pending-actions writes go through safeWriteFileSync " +
        "and honor PAX8_CONFIG_DIR under scale (1000+ companies)",
    );
  });
});
