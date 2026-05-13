// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import {
  runCli,
  runCliExpectSuccess,
  runCliExpectFailure,
} from "./test-utils.js";

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

    // Per #311: `--product` is optional on `quotes create`. Without it, the
    // command produces an empty draft quote (the natural shape for the v2
    // body `{ clientId, quoteRequestId? }`); with it, the command chains a
    // line-item POST as a convenience shorthand.
    it("declares --product as optional (#311)", async () => {
      const result = await runCliExpectSuccess(["quotes", "create", "--help"]);
      const optionsSection = result.stdout.split("Examples:")[0] ?? result.stdout;
      // Required options render as `--company <id|name>` with no surrounding
      // brackets in commander's help; optional ones are differentiated by
      // the help footer text describing them. We assert the help text frames
      // --product as optional / behavior-only-when-supplied.
      expect(optionsSection).toContain("--product");
      expect(optionsSection).toMatch(/[Oo]ptional|when set/);
    });

    it("describes the two-step body shape in the help footer (#311)", async () => {
      const result = await runCliExpectSuccess(["quotes", "create", "--help"]);
      expect(result.stdout).toContain("POST /v2/quotes");
      expect(result.stdout).toContain("clientId");
      // Both example shapes (empty + shorthand) should be visible.
      expect(result.stdout).toMatch(/Empty quote|empty draft|Empty/);
    });
  });

  describe("empty-quote path (#311)", () => {
    it("creates an empty draft quote when --product is not supplied", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "create",
        "--company",
        "Summit Healthcare Partners",
        "--json",
        "--yes",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]).toHaveProperty("id");
      expect(data[0].id).toMatch(/^quote-demo-/);
      expect(data[0].status).toBe("Draft");
      // Per the v2 spec, line items are never on the create response — the
      // mock returns an empty array here.
      expect(Array.isArray(data[0].lineItems)).toBe(true);
      expect(data[0].lineItems.length).toBe(0);
    });

    it("hints at `quotes line-items add` after creating an empty quote", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "create",
        "--company",
        "Summit Healthcare Partners",
        "--yes",
      ]);
      // The hint is on stderr (non-JSON path).
      expect(result.stderr).toContain("quotes line-items add");
    });
  });

  describe("shorthand --product path (#311)", () => {
    it("creates the quote then appends a single line item in one command", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "create",
        "--company",
        "Summit Healthcare Partners",
        "--product",
        "prod-m365-e3-0003",
        "--quantity",
        "5",
        "--billing-term",
        "Annual",
        "--json",
        "--yes",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]).toHaveProperty("id");
      expect(data[0].id).toMatch(/^quote-demo-/);
      // The line-item POST happens after create, so the returned quote
      // should reflect the appended item.
      expect(Array.isArray(data[0].lineItems)).toBe(true);
      expect(data[0].lineItems.length).toBe(1);
      expect(data[0].lineItems[0].productId).toBe("prod-m365-e3-0003");
      expect(data[0].lineItems[0].quantity).toBe(5);
    });

    it("rejects non-positive --quantity when --product is set", async () => {
      const result = await runCliExpectFailure([
        "quotes",
        "create",
        "--company",
        "Summit Healthcare Partners",
        "--product",
        "prod-m365-e3-0003",
        "--quantity",
        "-1",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/[Ii]nvalid quantity/);
    });
  });

  describe("line-item flag parity (#426)", () => {
    // Each newly-supported flag on the shorthand `quotes create` path
    // must actually apply to the line item that gets appended. Without
    // these tests, the parity check at
    // `quotes-create-line-items-parity.test.ts` would pin the *flag
    // surface* but not catch a regression where a flag is declared yet
    // silently dropped on the way to the line-item POST.

    it("--price flows through to the appended line item's unitPrice", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "create",
        "--company",
        "Summit Healthcare Partners",
        "--product",
        "prod-m365-e3-0003",
        "--quantity",
        "2",
        "--billing-term",
        "Monthly",
        "--price",
        "77.77",
        "--json",
        "--yes",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].lineItems.length).toBe(1);
      // Demo client persists unitPrice on the line; this is the regression
      // pin for "shorthand silently used the list price instead of --price."
      expect(data[0].lineItems[0].unitPrice).toBe(77.77);
    });

    it("--billing-term Annual produces a line item with billingTerm: \"Annual\"", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "create",
        "--company",
        "Summit Healthcare Partners",
        "--product",
        "prod-m365-e3-0003",
        "--quantity",
        "5",
        "--billing-term",
        "Annual",
        "--json",
        "--yes",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data[0].lineItems.length).toBe(1);
      expect(data[0].lineItems[0].billingTerm).toBe("Annual");
    });

    it("--effective-date YYYY-MM-DD is accepted and the line item is created", async () => {
      // The demo client doesn't always echo effectiveDate, but the flag
      // must be accepted end-to-end (parsed, validated, sent on the wire).
      const result = await runCliExpectSuccess([
        "quotes",
        "create",
        "--company",
        "Summit Healthcare Partners",
        "--product",
        "prod-m365-e3-0003",
        "--quantity",
        "1",
        "--effective-date",
        "2026-06-15",
        "--json",
        "--yes",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data[0].lineItems.length).toBe(1);
    });

    it("rejects malformed --effective-date with the same error shape as line-items add", async () => {
      const result = await runCliExpectFailure([
        "quotes",
        "create",
        "--company",
        "Summit Healthcare Partners",
        "--product",
        "prod-m365-e3-0003",
        "--quantity",
        "1",
        "--effective-date",
        "06/15/2026",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/effective-date/i);
    });

    it("rejects negative --price with the same error shape as line-items add", async () => {
      const result = await runCliExpectFailure([
        "quotes",
        "create",
        "--company",
        "Summit Healthcare Partners",
        "--product",
        "prod-m365-e3-0003",
        "--quantity",
        "1",
        "--price",
        "-5",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/[Ii]nvalid price/);
    });

    it("rejects a typo'd --billing-term up front (fail-fast)", async () => {
      const result = await runCliExpectFailure([
        "quotes",
        "create",
        "--company",
        "Summit Healthcare Partners",
        "--product",
        "prod-m365-e3-0003",
        "--quantity",
        "1",
        "--billing-term",
        "Annualy",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/billing-term/);
      expect(combined).toMatch(/Annualy/);
    });
  });

  describe("partial-failure recovery hint (#311)", () => {
    // The shorthand path is two wire calls (POST /v2/quotes, then
    // POST /v2/quotes/{id}/line-items). If the second succeeds-but-fails
    // after the first commits, the user has a created quote but no line
    // item — and no way to know what the new quote ID was. The command
    // must surface that ID prominently with a recovery hint per #311's
    // acceptance criteria.
    it("surfaces the created quote ID and recovery command when line-item add fails", async () => {
      const result = await runCli(
        [
          "quotes",
          "create",
          "--company",
          "Summit Healthcare Partners",
          "--product",
          "prod-m365-e3-0003",
          "--quantity",
          "5",
          "--yes",
        ],
        { PAX8_DEMO_FAIL_QUOTE_LINE_ITEM_ADD: "1" },
      );
      // The command should exit non-zero (line-item add failed) but only
      // after surfacing the created quote ID and the recovery hint.
      expect(result.exitCode).not.toBe(0);
      // The recovery hint mentions the quote was created.
      expect(result.stderr).toMatch(/[Qq]uote .* was created/);
      // It surfaces the new quote ID (demo IDs start with `quote-demo-`).
      expect(result.stderr).toMatch(/quote-demo-\d+/);
      // It offers a concrete recovery command pointing at `quotes line-items add`.
      expect(result.stderr).toContain("quotes line-items add");
      expect(result.stderr).toContain("--product");
      expect(result.stderr).toContain("--quantity");
    });
  });
});
