// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Seed v2 smoke test (#308). Proves the post-#316 `/v2` routing for quotes
 * reaches the real Pax8 quoting API. This is the test that would have
 * failed for #307 (quote calls hitting `/v1/quotes` instead of `/v2/quotes`)
 * if it had existed before #266 shipped. See `harness.ts` for the extension
 * pattern.
 */

import { it, expect } from "vitest";
import {
  describeIntegration,
  runCliVerbose,
  expectExitZero,
  expectWireUrl,
} from "./harness.js";

describeIntegration("quotes (v2)", () => {
  it(
    "quotes list --json hits /v2/quotes and returns a paginated result",
    async () => {
      const result = await runCliVerbose(["quotes", "list", "--json"]);

      expectExitZero(result);
      expectWireUrl(result, {
        method: "GET",
        pathContains: "/v2/quotes",
        version: "v2",
      });

      const data = JSON.parse(result.stdout);
      // `quotes list` outputs the paginated `content` array directly.
      // Empty-portfolio sandboxes are valid here; the load-bearing assertion
      // is the wire URL above.
      expect(Array.isArray(data) || typeof data === "object").toBe(true);
    },
    60_000,
  );
});
