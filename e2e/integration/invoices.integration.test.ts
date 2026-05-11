// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Wire smoke test for the v1 invoices resource. Ported from the retired
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

describeIntegration("invoices (v1)", () => {
  it(
    "invoices list --json hits /v1/invoices and returns an array",
    async () => {
      const result = await runCliVerbose(["invoices", "list", "--json"]);

      expectExitZero(result);
      expectWireUrl(result, {
        method: "GET",
        pathContains: "/v1/invoices",
        version: "v1",
      });

      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      // May be empty on a fresh sandbox — wire URL is the load-bearing check.
    },
    60_000,
  );
});
