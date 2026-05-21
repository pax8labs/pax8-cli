// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Orders v1 wire smoke + default-sort pin (#478).
 *
 * The first test mirrors `companies.integration.test.ts`: it proves the
 * CLI's orders surface still routes to `/v1/orders`. If a future refactor
 * accidentally points orders at a different version segment, this catches
 * it before partners do — same regression class as the #307 quotes bug.
 * It also asserts the `--json` envelope now wraps `{ orders, page }` per
 * #478 — pre-fix output was a flat array, which hid pagination from
 * partners and agents on portfolios with thousands of orders.
 *
 * The second test pins the default sort hint that the CLI sends on every
 * `orders list` request (`sort=createdAt,desc`) — pre-#478 the CLI sent
 * nothing and the real API returned 2013-era orders in row 1 on long-lived
 * tenants. The `--status` flag was removed entirely in the same PR (it
 * never worked end-to-end and the server silently ignored every value);
 * if the Pax8 Orders team lands real status filtering under #369 we can
 * re-add the flag honestly.
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
});
