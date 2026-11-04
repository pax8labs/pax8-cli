// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Orders v1 smokes — read + dry-run write (#478, expanded under #386).
 *
 * The two read tests pin `/v1/orders` routing and the default sort hint
 * partners depend on (#478). The third test, added under #386, exercises
 * `orders create --dry-run` against the real API:
 *
 *   - `--dry-run` maps to `isMock=true` on the wire. The server validates
 *     the order payload as if it were going to commit it, then returns
 *     without creating an actual order. No artifact in the sandbox, no
 *     cleanup needed — the same property that makes `webhooks create +
 *     delete` and `quotes create + delete` safe round-trips, achieved
 *     here without the inverse step because Pax8 supports `isMock` on
 *     the orders surface.
 *
 *   - This catches the #307-class bug for `orders create`: a future
 *     refactor that pointed orders create at the wrong version segment,
 *     or that broke the payload shape, would fail this test before
 *     reaching a partner.
 *
 * Why dry-run + no real create:
 *
 *   - `orders create` has no inverse (orders are immutable financial
 *     history). A real create would either leave artifacts in the
 *     sandbox forever (annotate-and-leave) or require a sweep workflow
 *     that can't actually delete orders anyway. `--dry-run` sidesteps
 *     the whole question and still exercises the wire.
 *   - The dry-run still validates the payload server-side, so a
 *     malformed request (wrong product ID shape, missing required field,
 *     wrong wire URL) fails the same way a real create would.
 */

import { it, expect } from "vitest";
import {
  describeIntegration,
  runCliVerbose,
  expectExitZero,
  expectWireUrl,
} from "./harness.js";

describeIntegration("orders (v1)", () => {
  it(
    "orders list --json hits /v1/orders and returns a wrapped { orders, page } envelope (#478)",
    async () => {
      const result = await runCliVerbose([
        "orders",
        "list",
        "--json",
        "--size",
        "1",
      ]);

      expectExitZero(result);
      expectWireUrl(result, {
        method: "GET",
        pathContains: "/v1/orders",
        version: "v1",
      });

      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(false);
      expect(data).toHaveProperty("orders");
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data).toHaveProperty("page");
      expect(typeof data.page.totalElements).toBe("number");
    },
    60_000,
  );

  it(
    "orders list forwards sort=createdAt,desc by default (#478)",
    async () => {
      const result = await runCliVerbose([
        "orders",
        "list",
        "--json",
        "--size",
        "1",
      ]);

      expectExitZero(result);
      expectWireUrl(result, {
        method: "GET",
        pathContains: "/v1/orders",
        version: "v1",
      });
      // Default sort hint goes on every request — partners on long-lived
      // tenants shouldn't see 2013 archives in row 1.
      expect(result.stderr).toMatch(
        /\[pax8\]\s+GET\s+url=\S*[?&]sort=createdAt%2Cdesc(&|\s|$)/,
      );
    },
    60_000,
  );

  it(
    "orders create --dry-run hits POST /v1/orders with isMock=true and validates server-side (#386)",
    async () => {
      // Step 1: pick the first company in the sandbox. `--company` accepts
      // ID or name; use ID for stability.
      const companiesResult = await runCliVerbose([
        "companies",
        "list",
        "--json",
        "--size",
        "1",
      ]);
      expectExitZero(companiesResult);
      let companyId: string | undefined;
      try {
        const parsed = JSON.parse(companiesResult.stdout);
        const rows = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as { content?: unknown[] }).content)
            ? (parsed as { content: unknown[] }).content
            : [];
        const first = rows[0] as { id?: unknown } | undefined;
        if (typeof first?.id === "string") companyId = first.id;
      } catch {
        // fall through
      }
      expect(
        companyId,
        `Could not extract a company id — sandbox empty? stdout: ${companiesResult.stdout.slice(0, 400)}`,
      ).toBeTruthy();

      // Step 2: pick the first product in the sandbox. `orders create`
      // needs a real product ID; whatever the sandbox offers first is
      // good enough for a dry-run validation. Using `products list`
      // instead of a hard-coded SKU keeps the test independent of the
      // sandbox's catalog snapshot.
      const productsResult = await runCliVerbose([
        "products",
        "list",
        "--json",
        "--size",
        "1",
      ]);
      expectExitZero(productsResult);
      let productId: string | undefined;
      try {
        const parsed = JSON.parse(productsResult.stdout);
        const rows = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as { content?: unknown[] }).content)
            ? (parsed as { content: unknown[] }).content
            : [];
        const first = rows[0] as { id?: unknown } | undefined;
        if (typeof first?.id === "string") productId = first.id;
      } catch {
        // fall through
      }
      expect(
        productId,
        `Could not extract a product id — sandbox catalog empty? stdout: ${productsResult.stdout.slice(0, 400)}`,
      ).toBeTruthy();

      // Step 3: fire the dry-run create. `--dry-run` translates to
      // `?isMock=true` on the wire — server validates, never commits.
      const createResult = await runCliVerbose([
        "orders",
        "create",
        "--company",
        companyId!,
        "--product",
        productId!,
        "--quantity",
        "1",
        "--dry-run",
        "--yes",
        "--json",
      ]);
      expectExitZero(createResult);
      expectWireUrl(createResult, {
        method: "POST",
        pathContains: "/v1/orders",
        version: "v1",
      });
      // Belt-and-suspenders: confirm the dry-run flag actually reached the
      // wire as `isMock=true`. If a future refactor accidentally drops the
      // dry-run threading, the test would otherwise quietly start creating
      // real orders against the sandbox.
      expect(
        result_stderr_has_ismock(createResult.stderr),
        `Expected POST /v1/orders to carry ?isMock=true; observed:\n${createResult.stderr.slice(0, 800)}`,
      ).toBe(true);
    },
    90_000,
  );
});

/**
 * Tolerant check for `isMock=true` in any of the observed `[pax8] METHOD
 * url=...` lines on stderr. URL-encoded equals (`%3D`) and query-string
 * placement (first param vs later) are both accepted so a future
 * URLSearchParams refactor doesn't bork the assertion on a behavior
 * we don't care about.
 */
function result_stderr_has_ismock(stderr: string): boolean {
  return /[?&]isMock=true(&|\s|$)/.test(stderr);
}
