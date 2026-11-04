// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Webhooks wire smoke + write round-trip (#308 + first batch of #386).
 *
 * Two purposes:
 *
 * 1. **Read smoke (`webhooks list`).** Same pattern as `companies.integration.test.ts`
 *    and the v2 quotes/orders smokes — pins the resolved URL to the documented
 *    `/api/v2/webhooks` path so a future version-segment regression (the #307
 *    class of bug) gets caught at this layer instead of by a partner.
 *
 * 2. **Write round-trip (`webhooks create` → `webhooks delete`).** The first
 *    wire-level write integration test in the repo (#386). Webhooks were
 *    chosen as the safest first target because:
 *
 *    - Self-contained: webhooks don't affect billing, orders, customers, or
 *      anything else partners can see. A leaked artifact is annoying, not
 *      damaging.
 *    - Full CRUD: the CLI has both `webhooks create` and `webhooks delete`,
 *      so the test can clean up after itself in-band — no separate cleanup
 *      pass needed.
 *    - Non-routable callback URL: `https://example.invalid/...` is reserved
 *      by RFC 6761; the Pax8 webhook delivery service will never actually
 *      fire against it, so even if the cleanup fails, no real traffic
 *      escapes.
 *    - Topic vocabulary: `quote.created` is a known-good topic (per the
 *      v2 webhooks-endpoints.json spec) so the API accepts the create
 *      payload without contention with other resources.
 *
 *    Cleanup discipline: the create test captures the new webhook's `id` and
 *    immediately fires a `delete` for it. If either step fails the test
 *    fails loudly — and even on partial failure the callback URL is
 *    non-routable, so the worst case is a single dangling row in the
 *    sandbox tenant's webhooks list that a manual sweep can pick up. The
 *    test does NOT leave a `try/finally` cleanup deliberately: if the
 *    delete is failing systematically we want red CI, not silent green.
 *
 * # Adding more write round-trips after this lands (#386 follow-ups)
 *
 * The pattern in `webhooks create + delete` below generalizes: identify a
 * resource with a quick inverse operation (quotes create+delete, contacts
 * create+delete), use a non-routable / non-billable fixture for any
 * interpolated identifiers, capture the ID from the create response, fire
 * the inverse, assert both wire URLs. Resources without an inverse
 * (orders create has no `orders cancel`; subscriptions cancel has no
 * inverse) need a different cleanup story — either a dedicated sandbox
 * tenant + periodic sweep, or annotate-and-leave with a documented
 * cleanup checklist. Out of scope for this first batch.
 */

import { it, expect } from "vitest";
import {
  describeIntegration,
  runCliVerbose,
  expectExitZero,
  expectWireUrl,
} from "./harness.js";

describeIntegration("webhooks (v2)", () => {
  it(
    "webhooks list --json hits /api/v2/webhooks",
    async () => {
      const result = await runCliVerbose(["webhooks", "list", "--json"]);

      expectExitZero(result);
      expectWireUrl(result, {
        method: "GET",
        pathContains: "/api/v2/webhooks",
      });
    },
    60_000,
  );

  it(
    "webhooks create + delete round-trip cleans up after itself (#386)",
    async () => {
      // The fixture: non-routable callback URL + a known-good topic from
      // the v2 webhooks-endpoints.json spec. The display name includes a
      // timestamp so concurrent runs in the same sandbox don't collide on
      // the API's uniqueness checks (if any).
      const callbackUrl = `https://example.invalid/pax8-cli-integration-${Date.now()}`;
      const displayName = `pax8-cli integration test (${new Date().toISOString()})`;

      const createResult = await runCliVerbose([
        "webhooks",
        "create",
        "--url",
        callbackUrl,
        "--display-name",
        displayName,
        "--topics",
        "quote.created",
        "--yes",
        "--json",
      ]);

      expectExitZero(createResult);
      expectWireUrl(createResult, {
        method: "POST",
        pathContains: "/api/v2/webhooks",
      });

      // Pull the new webhook's `id` out of the stdout JSON envelope. The
      // exact stdout shape is `{ webhook: {...} }` per the create command,
      // but tolerate the flat-object form too so a future envelope
      // refactor doesn't bork the test before the assertion runs. If the
      // ID can't be located the test fails with a useful dump.
      let createdId: string | undefined;
      try {
        const parsed = JSON.parse(createResult.stdout);
        createdId =
          parsed?.webhook?.id ??
          parsed?.id ??
          parsed?.data?.id ??
          undefined;
      } catch {
        // fall through to the assertion below
      }
      expect(
        createdId,
        `Could not find created webhook id in stdout — got: ${createResult.stdout.slice(0, 400)}`,
      ).toBeTruthy();

      // Immediate cleanup. If this fails the test goes red and the sandbox
      // is left with a single dangling row pointing at a non-routable URL —
      // safe to sweep manually.
      const deleteResult = await runCliVerbose([
        "webhooks",
        "delete",
        createdId!,
        "--yes",
      ]);

      expectExitZero(deleteResult);
      expectWireUrl(deleteResult, {
        method: "DELETE",
        pathContains: `/api/v2/webhooks/${createdId}`,
      });
    },
    60_000,
  );
});
