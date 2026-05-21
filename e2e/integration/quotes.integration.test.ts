// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Quotes v2 smokes — read + write (#308, expanded under #386).
 *
 * The seed read test (`quotes list`) pins the post-#316 `/v2` routing — it's
 * the test that would have failed for #307 (quote calls hitting `/v1/quotes`
 * instead of `/v2/quotes`) if it had existed before #266 shipped.
 *
 * The write round-trip (`quotes create` → `quotes delete`) follows the
 * pattern proven in `webhooks.integration.test.ts` (#386 first batch):
 * pick the safest possible inputs, capture the new resource's `id`, and
 * fire the inverse operation in-band so the test cleans up after itself.
 *
 * Quotes was chosen as the second write target (after webhooks) because:
 *
 *   - Full CRUD: the CLI has both `quotes create` and `quotes delete`.
 *   - Draft-state creates are non-binding: a quote created without
 *     `quotes send` never reaches the customer, so even if the delete
 *     misses there's no partner-visible side effect.
 *   - `--product` is optional on create: an empty-line-item quote is
 *     the minimal possible write, with no dependency on a known-good
 *     product ID in the sandbox.
 *
 * Sandbox prerequisite: the tenant must have at least one company
 * (any status) for the quote to attach to. The test fetches the first
 * row from `companies list --json` rather than hard-coding an ID so it
 * runs against any sandbox.
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

  it(
    "quotes create + delete round-trip cleans up after itself (#386)",
    async () => {
      // Step 1: pick the first company in the sandbox to attach the draft
      // quote to. Using `companies list --size 1` keeps the test
      // self-sufficient — no hard-coded ID, works against any sandbox
      // that has at least one company on file.
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
        // fall through to assertion below
      }
      expect(
        companyId,
        `Could not extract a company id from companies list — sandbox empty? stdout: ${companiesResult.stdout.slice(0, 400)}`,
      ).toBeTruthy();

      // Step 2: create an empty-line-item draft quote attached to that
      // company. No `--product`, no `--send` — the smallest possible
      // write that exercises the `POST /v2/quotes` wire surface.
      const createResult = await runCliVerbose([
        "quotes",
        "create",
        "--company",
        companyId!,
        "--yes",
        "--json",
      ]);
      expectExitZero(createResult);
      expectWireUrl(createResult, {
        method: "POST",
        pathContains: "/v2/quotes",
        version: "v2",
      });

      // Capture the new quote's id from stdout. Tolerate a `{ quote: {...} }`
      // envelope or a flat object so a future envelope refactor doesn't
      // break the test before the assertion fires.
      let quoteId: string | undefined;
      try {
        const parsed = JSON.parse(createResult.stdout);
        const id =
          parsed?.quote?.id ??
          parsed?.id ??
          parsed?.data?.id ??
          undefined;
        if (typeof id === "string") quoteId = id;
        else if (typeof id === "number") quoteId = String(id);
      } catch {
        // fall through
      }
      expect(
        quoteId,
        `Could not find created quote id in stdout — got: ${createResult.stdout.slice(0, 400)}`,
      ).toBeTruthy();

      // Step 3: delete the just-created quote. If this fails the test goes
      // red and the sandbox is left with a single dangling draft quote —
      // non-binding (never sent) and easy to sweep by name.
      const deleteResult = await runCliVerbose([
        "quotes",
        "delete",
        quoteId!,
        "--yes",
      ]);
      expectExitZero(deleteResult);
      expectWireUrl(deleteResult, {
        method: "DELETE",
        pathContains: `/v2/quotes/${quoteId}`,
        version: "v2",
      });
    },
    90_000,
  );
});
