// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Wire smoke test for the v1 subscriptions resource. Ported from the retired
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

describeIntegration("subscriptions (v1)", () => {
  it(
    "subscriptions list --json hits /v1/subscriptions and returns an array",
    async () => {
      const result = await runCliVerbose([
        "subscriptions",
        "list",
        "--json",
        "--size",
        "10",
      ]);

      expectExitZero(result);
      expectWireUrl(result, {
        method: "GET",
        pathContains: "/v1/subscriptions",
        version: "v1",
      });

      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      // Don't assert length > 0 — an empty-portfolio sandbox is still a
      // valid v1 read. The load-bearing assertion is the wire URL above.
    },
    60_000,
  );
});
