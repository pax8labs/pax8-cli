// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("pax8 quotes create", () => {
  describe("--help", () => {
    // Regression guard for #306: `--expiration-date` on `quotes create` was a
    // silent no-op because `POST /v2/quotes` accepts only `{ clientId,
    // quoteRequestId? }` — there is no place for `expiresOn` on the create
    // body (see docs/triage/quotes-api-version.md §9.1). The flag was removed
    // and users are now directed at `pax8 quotes update <id>
    // --expiration-date <date>` for setting/changing expiration.
    //
    // If a future PR re-adds `--expiration-date` to `quotes create` without
    // also wiring it through to the API, this test fails loudly. Do not
    // delete this test just to make it pass — fix the create path properly
    // (verify the API accepts the field, extend CreateQuoteInputSchema, send
    // it through) or leave the flag off. #306.
    it("does not declare a --expiration-date option (#306 regression guard)", async () => {
      const result = await runCliExpectSuccess(["quotes", "create", "--help"]);
      // The help block lists each option on its own line, e.g.
      //   --quantity <number>     Quantity (default: "1")
      // We assert the flag does not appear as a declared option. A free-form
      // mention inside the "Setting an expiration date" help footer is fine —
      // that's the intentional pointer to `quotes update`.
      const optionsSection = result.stdout.split("Examples:")[0] ?? result.stdout;
      expect(optionsSection).not.toContain("--expiration-date");
    });

    it("points users at `quotes update --expiration-date` for setting expiration", async () => {
      const result = await runCliExpectSuccess(["quotes", "create", "--help"]);
      expect(result.stdout).toContain("pax8 quotes update");
      expect(result.stdout).toContain("--expiration-date");
    });
  });
});
