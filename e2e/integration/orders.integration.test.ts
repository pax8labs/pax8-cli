// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Orders v1 wire smoke + `--status` no-op pin.
 *
 * The first test mirrors `companies.integration.test.ts`: it proves the
 * CLI's orders surface still routes to `/v1/orders`. If a future refactor
 * accidentally points orders at a different version segment, this catches
 * it before partners do — same regression class as the #307 quotes bug.
 *
 * The second test pins the wire-level behavior verified against the real
 * API on 2026-05-11 (see `docs/triage/orders-status-server-behavior.md`):
 *
 *   - The server silently ignores `?status=` (every value, including bogus
 *     ones, returns the unfiltered set).
 *   - The CLI still forwards the flag on the wire so existing partner
 *     scripts don't break.
 *
 * If Pax8's Orders team ever lands real `status` filtering (tracked in
 * #369), this test continues to pass — it only asserts the CLI forwards
 * the parameter and the URL still resolves to `/v1/orders`, both of which
 * remain true under real filtering. The actual ignored-vs-honored behavior
 * is a server-side concern; we record it in the triage doc rather than
 * re-asserting it on every test run.
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
    "orders list --json hits /v1/orders and returns an array",
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
      expect(Array.isArray(data)).toBe(true);
    },
    60_000,
  );

  it(
    "orders list --status forwards the param on the wire (#369)",
    async () => {
      const result = await runCliVerbose([
        "orders",
        "list",
        "--json",
        "--size",
        "1",
        "--status",
        "Completed",
      ]);

      expectExitZero(result);
      expectWireUrl(result, {
        method: "GET",
        pathContains: "/v1/orders",
        version: "v1",
      });
      // `--status` must reach the wire even though the server ignores it —
      // dropping it client-side would surprise partner scripts that depend
      // on the flag being forwarded for future-compat with PAM-side fixes.
      expect(result.stderr).toMatch(
        /\[pax8\]\s+GET\s+url=\S*[?&]status=Completed(&|\s|$)/,
      );
    },
    60_000,
  );
});
