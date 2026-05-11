// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Wire smoke test for the v1 products resource. Ported from the retired
 * `e2e/real-api.test.ts` (#357) and reframed as a wire-URL assertion per the
 * #308 contract — the original test only checked response shape and would
 * not have caught a wrong-version regression.
 */

import { it, expect } from "vitest";
import {
  describeIntegration,
  runCliVerbose,
  expectExitZero,
  expectWireUrl,
} from "./harness.js";

describeIntegration("products (v1)", () => {
  it(
    'products search "Microsoft" --json hits /v1/products and returns an array',
    async () => {
      const result = await runCliVerbose([
        "products",
        "search",
        "Microsoft",
        "--json",
      ]);

      expectExitZero(result);
      expectWireUrl(result, {
        method: "GET",
        pathContains: "/v1/products",
        version: "v1",
      });

      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      // Don't assert length > 0 — the wire URL is the load-bearing check.
    },
    60_000,
  );
});
