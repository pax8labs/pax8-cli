// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("pax8 invoices", () => {
  describe("invoices list", () => {
    it("lists invoices in demo mode", async () => {
      const result = await runCliExpectSuccess(["invoices", "list", "--json"]);
      // #483: JSON envelope is { invoices, page } (was a flat array).
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("invoices");
      expect(data).toHaveProperty("page");
      expect(Array.isArray(data.invoices)).toBe(true);
      expect(data.invoices.length).toBeGreaterThan(0);
      expect(data.invoices[0]).toHaveProperty("id");
      expect(data.invoices[0]).toHaveProperty("companyName");
      expect(data.invoices[0]).toHaveProperty("total");
      expect(data.invoices[0]).toHaveProperty("status");
      expect(data.page.number).toBe(1);
    });

    it("filters by month", async () => {
      // Get current month in YYYY-MM format
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      const result = await runCliExpectSuccess([
        "invoices",
        "list",
        "--month",
        currentMonth,
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.invoices.length).toBeGreaterThan(0);
      for (const inv of data.invoices) {
        expect(inv.invoiceDate).toContain(currentMonth);
      }
    });

    it("filters by company", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "list",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.invoices.length).toBeGreaterThan(0);
      for (const inv of data.invoices) {
        expect(inv.companyId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      }
    });

    // #389: spec-backed date range filter. `--from` / `--to` are ergonomic
    // aliases for `invoiceDateRangeStart` / `invoiceDateRangeEnd`. Demo data
    // generates invoices on the 1st of the current and previous months.
    it("filters by --from / --to (#389)", async () => {
      // Compute the start of the current month and use a tight window around it
      // so we hit current-month invoices but not last-month ones.
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const from = `${y}-${m}-01`;
      const to = `${y}-${m}-28`;
      const result = await runCliExpectSuccess([
        "invoices",
        "list",
        "--from",
        from,
        "--to",
        to,
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.invoices.length).toBeGreaterThan(0);
      for (const inv of data.invoices) {
        expect(inv.invoiceDate >= from).toBe(true);
        expect(inv.invoiceDate <= to).toBe(true);
      }
    });

    it("--status Unpaid filters server-side (#389)", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "list",
        "--status",
        "Unpaid",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.invoices.length).toBeGreaterThan(0);
      for (const inv of data.invoices) {
        expect(inv.status).toBe("Unpaid");
      }
    });

    it("--sort due-date maps to spec's camelCase dueDate (#389)", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "list",
        "--sort",
        "due-date",
        "--size",
        "100",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      const dueDates = data.invoices.map((i: { dueDate: string }) => i.dueDate);
      const sorted = [...dueDates].sort((a, b) => a.localeCompare(b));
      expect(dueDates).toEqual(sorted);
    });

    it("--with-actions adds nextActions to { invoices, page } envelope", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "list",
        "--json",
        "--with-actions",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("invoices");
      expect(data).toHaveProperty("page");
      expect(data).toHaveProperty("nextActions");
      expect(Array.isArray(data.invoices)).toBe(true);
      expect(Array.isArray(data.nextActions)).toBe(true);
      expect(data.nextActions.length).toBeGreaterThan(0);
      for (const action of data.nextActions) {
        expect(action).toHaveProperty("command");
        expect(action).toHaveProperty("description");
      }
    });
  });

  describe("invoices show", () => {
    it("shows invoice detail in JSON", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "show",
        "inv-summit-curr-001",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      // `show` returns a single object, not an array (#208)
      expect(Array.isArray(data)).toBe(false);
      expect(data).toHaveProperty("id", "inv-summit-curr-001");
      expect(data).toHaveProperty("companyName", "Summit Healthcare Partners");
      expect(data).toHaveProperty("total");
      expect(data).toHaveProperty("status");
      expect(data).toHaveProperty("balance");
      expect(data).toHaveProperty("currency");
    });
  });

  describe("invoices items", () => {
    it("lists invoice items in demo mode", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "items",
        "--json",
      ]);
      // #483: JSON envelope is { items, page }.
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("items");
      expect(data).toHaveProperty("page");
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.items[0]).toHaveProperty("productName");
      expect(data.items[0]).toHaveProperty("quantity");
      expect(data.items[0]).toHaveProperty("price");
      expect(data.items[0]).toHaveProperty("subTotal");
    });

    it("filters items by invoice ID", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "items",
        "--invoice-id",
        "inv-summit-curr-001",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.items.length).toBeGreaterThan(0);
      for (const item of data.items) {
        expect(item.invoiceId).toBe("inv-summit-curr-001");
      }
    });
  });

  describe("invoices audit", () => {
    it("produces audit report in JSON", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "audit",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data[0]).toHaveProperty("discrepancies");
      expect(data[0]).toHaveProperty("totalOvercharge");
      expect(data[0]).toHaveProperty("totalUndercharge");
      expect(data[0]).toHaveProperty("netImpact");
      expect(data[0]).toHaveProperty("itemsAudited");
      expect(data[0].discrepancies.length).toBeGreaterThan(0);
    });

    it("each discrepancy has required fields", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "audit",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      const disc = data[0].discrepancies[0];
      expect(disc).toHaveProperty("companyName");
      expect(disc).toHaveProperty("productName");
      expect(disc).toHaveProperty("invoicedQuantity");
      expect(disc).toHaveProperty("activeQuantity");
      expect(disc).toHaveProperty("delta");
      expect(disc).toHaveProperty("dollarImpact");
      expect(disc).toHaveProperty("type");
    });

    // #M-1: `--month` is interpolated into `nextActions[].command` strings on
    // stdout. Agents (the Claude skill, scripts) extract that field and exec
    // it, so a value like "2026-01; rm -rf ~" would turn the read into shell
    // injection. The validator rejects at the parse boundary with
    // ERROR_INVALID_INPUT before any side effects.
    it("rejects --month with shell metacharacters (#M-1)", async () => {
      const result = await runCliExpectFailure([
        "invoices",
        "audit",
        "--month",
        "2026-01; rm -rf",
        "--json",
      ]);
      expect(result.stderr).toMatch(/Invalid value for --month/i);
      // JSON error envelope carries the structured code. stderr also has a
      // demo banner and spinner-fail glyph before the envelope; grab the
      // first `{`-bracketed payload to parse.
      const envelope = JSON.parse(extractJsonEnvelope(result.stderr));
      expect(envelope.code).toBe("ERROR_INVALID_INPUT");
    });

    it("rejects --month with garbage shape (#M-1)", async () => {
      const result = await runCliExpectFailure([
        "invoices",
        "audit",
        "--month",
        "not-a-month",
        "--json",
      ]);
      expect(result.stderr).toMatch(/Invalid value for --month/i);
    });

    it("rejects --month with out-of-range month (#M-1)", async () => {
      const result = await runCliExpectFailure([
        "invoices",
        "audit",
        "--month",
        "2026-13",
        "--json",
      ]);
      expect(result.stderr).toMatch(/Invalid value for --month/i);
    });
  });

  // #M-1: same validator runs on `pax8 invoices dispute --month` — that
  // command also emits a `nextActions[].command` string that interpolates
  // the user-supplied value (line ~417 in dispute.ts).
  describe("invoices dispute --month validation (#M-1)", () => {
    it("rejects --month with shell metacharacters", async () => {
      const result = await runCliExpectFailure([
        "invoices",
        "dispute",
        "--discrepancy",
        "disc-deadbeef0000",
        "--month",
        "2026-01; echo pwned",
        "--json",
        "-y",
      ]);
      expect(result.stderr).toMatch(/Invalid value for --month/i);
      const envelope = JSON.parse(extractJsonEnvelope(result.stderr));
      expect(envelope.code).toBe("ERROR_INVALID_INPUT");
    });
  });

  describe("invoices --help", () => {
    it("shows invoices subcommands", async () => {
      const result = await runCliExpectSuccess(["invoices", "--help"]);
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("show");
      expect(result.stdout).toContain("items");
      expect(result.stdout).toContain("audit");
    });

    // #389: every spec-backed filter must appear in --help. Pre-#389 the CLI
    // didn't surface --from / --to / --sort at all.
    it("list --help advertises every #389 filter and sort flag", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "list",
        "--help",
      ]);
      const flat = result.stdout.replace(/\s+/g, " ");
      // Date range
      expect(flat).toContain("--from");
      expect(flat).toContain("--to");
      // Sort + a sampling of the documented spec enum values (in kebab-case
      // since that is the user-facing flag-value form).
      expect(flat).toContain("--sort");
      for (const v of [
        "invoice-date",
        "due-date",
        "status",
        "partner-name",
        "total",
        "balance",
        "carried-balance",
      ]) {
        expect(flat).toContain(v);
      }
    });

    // #250: `--status` help text must enumerate every value documented for
    // `GET /invoices`'s `status` query parameter. Previously the help listed
    // only 4 of the 6 documented values (`Nothing Due` and `Credited` were
    // missing).
    it("list --status help advertises every documented API enum value (#250)", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "list",
        "--help",
      ]);
      // Commander wraps long option descriptions across lines on narrow
      // terminals, so collapse whitespace before matching multi-word values.
      const flat = result.stdout.replace(/\s+/g, " ");
      const DOCUMENTED_STATUSES = [
        "Unpaid",
        "Paid",
        "Void",
        "Carried",
        "Nothing Due",
        "Credited",
      ];
      for (const status of DOCUMENTED_STATUSES) {
        expect(flat).toContain(status);
      }
    });
  });
});

/**
 * Pull the JSON error envelope out of stderr. Demo mode prints a banner and
 * spinner-fail glyph before the envelope when `--json` is set, so we can't
 * `JSON.parse(stderr)` directly. The envelope is the JSON object that
 * starts at the first `{` in stderr.
 */
function extractJsonEnvelope(stderr: string): string {
  const start = stderr.indexOf("{");
  if (start < 0) throw new Error("no JSON envelope in stderr: " + stderr);
  return stderr.slice(start);
}
