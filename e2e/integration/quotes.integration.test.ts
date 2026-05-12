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

      // #384: assert at least one row carries a non-empty `companyId` when
      // the sandbox has any quotes. Pre-#384, `companyId` was undefined on
      // every row because the Zod schema expected a flat `companyId` while
      // the v2 API returns `client: {id, ...}` nested — the unknown key
      // was silently dropped and the required `companyId` parse failed (or
      // landed as undefined depending on permissiveness). The schema now
      // preprocesses `client.id → companyId` so partners get a usable ID
      // back. Empty-portfolio sandboxes still skip the assertion.
      const rows = Array.isArray(data)
        ? data
        : Array.isArray((data as { content?: unknown[] }).content)
          ? (data as { content: unknown[] }).content
          : [];
      if (rows.length > 0) {
        const first = rows[0] as { companyId?: unknown };
        expect(typeof first.companyId).toBe("string");
        expect((first.companyId as string).length).toBeGreaterThan(0);
      }
    },
    60_000,
  );
});
