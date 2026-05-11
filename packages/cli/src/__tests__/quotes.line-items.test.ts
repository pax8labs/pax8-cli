// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("pax8 quotes line-items", () => {
  describe("line-items list", () => {
    it("returns the line items array in JSON", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "line-items",
        "list",
        "quote-summit-001",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("productId");
      expect(data[0]).toHaveProperty("quantity");
      expect(data[0].id).toBe("li-summit-001-a");
    });

    it("emits one ID per line with --ids-only", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "line-items",
        "list",
        "quote-summit-001",
        "--ids-only",
      ]);
      const lines = result.stdout.trim().split("\n").filter(Boolean);
      expect(lines).toEqual(["li-summit-001-a", "li-summit-001-b"]);
    });

    it("returns empty/zero when the quote ID is unknown", async () => {
      const result = await runCliExpectFailure([
        "quotes",
        "line-items",
        "list",
        "no-such-quote",
        "--json",
      ]);
      // 404 path is centralized; just verify the failure surfaces.
      expect(result.exitCode).toBe(1);
    });
  });

  describe("line-items add", () => {
    it("adds a line item and prints the new ID + count (auto-confirm with -y, default price resolves from product catalog)", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "line-items",
        "add",
        "quote-redwood-001",
        "--product",
        "prod-aad-p1-0008",
        "--quantity",
        "3",
        "--billing-term",
        "Annual",
        "--json",
        "--yes",
      ]);
      const data = JSON.parse(result.stdout);
      // JSON mode wraps the response in a single-element array.
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]).toHaveProperty("quoteId", "quote-redwood-001");
      expect(data[0]).toHaveProperty("lineItemId");
      expect(typeof data[0].lineItemId).toBe("string");
      expect(data[0].lineItemId).toMatch(/^li-/);
      // Started at 1 line item, should now be 2.
      expect(data[0].lineItemCount).toBe(2);
      // The default-price resolution should produce a non-null unitPrice on
      // the newly added line. Per #312: with no `--price` flag, the command
      // looks up the product's list price for the chosen billing term.
      const newLineId = data[0].lineItemId as string;
      const newLine = (data[0].quote.lineItems as Array<{ id: string; unitPrice?: number }>).find(
        (li) => li.id === newLineId,
      );
      expect(newLine).toBeDefined();
      expect(typeof newLine?.unitPrice).toBe("number");
      expect(newLine!.unitPrice).toBeGreaterThan(0);
    });

    it("--price overrides the resolved default", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "line-items",
        "add",
        "quote-redwood-001",
        "--product",
        "prod-aad-p1-0008",
        "--quantity",
        "2",
        "--billing-term",
        "Monthly",
        "--price",
        "99.99",
        "--json",
        "--yes",
      ]);
      const data = JSON.parse(result.stdout);
      const newLineId = data[0].lineItemId as string;
      const newLine = (data[0].quote.lineItems as Array<{ id: string; unitPrice?: number }>).find(
        (li) => li.id === newLineId,
      );
      // Confirms the explicit --price flows through to the mock client and
      // wins over the default list-price lookup.
      expect(newLine?.unitPrice).toBe(99.99);
    });

    it("--effective-date accepts YYYY-MM-DD", async () => {
      // The mock client doesn't persist effectiveDate in the demo line item
      // shape, but we exercise the CLI plumbing end-to-end — the command must
      // parse the flag, validate the format, and exit 0.
      const result = await runCliExpectSuccess([
        "quotes",
        "line-items",
        "add",
        "quote-redwood-001",
        "--product",
        "prod-aad-p1-0008",
        "--quantity",
        "1",
        "--effective-date",
        "2026-06-15",
        "--json",
        "--yes",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data[0]).toHaveProperty("lineItemId");
    });

    it("rejects malformed --effective-date", async () => {
      const result = await runCliExpectFailure([
        "quotes",
        "line-items",
        "add",
        "quote-redwood-001",
        "--product",
        "prod-aad-p1-0008",
        "--quantity",
        "1",
        "--effective-date",
        "06/15/2026",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/effective-date/i);
    });

    it("rejects negative --price", async () => {
      const result = await runCliExpectFailure([
        "quotes",
        "line-items",
        "add",
        "quote-redwood-001",
        "--product",
        "prod-aad-p1-0008",
        "--quantity",
        "1",
        "--price",
        "-1",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/[Ii]nvalid price/);
    });

    it("rejects non-positive quantity", async () => {
      const result = await runCliExpectFailure([
        "quotes",
        "line-items",
        "add",
        "quote-summit-001",
        "--product",
        "prod-aad-p1-0008",
        "--quantity",
        "-2",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/[Ii]nvalid quantity/);
    });

    it("requires --product", async () => {
      const result = await runCliExpectFailure([
        "quotes",
        "line-items",
        "add",
        "quote-summit-001",
        "--quantity",
        "1",
        "--yes",
      ]);
      expect(result.stderr).toContain("--product");
    });

    it("cancels cleanly when the user answers no at the prompt", async () => {
      // When stdin isn't a TTY, the prompt sees EOF — empty answer means
      // "use default", which for `add` is `true`. To assert the cancel path
      // we feed a literal "n" on stdin via a child process. runCli doesn't
      // support stdin; use Node's spawn instead.
      const { spawn } = await import("node:child_process");
      const { resolve } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const cliPath = resolve(
        fileURLToPath(import.meta.url),
        "../../../dist/index.js",
      );
      const child = spawn(
        "node",
        [
          cliPath,
          "quotes",
          "line-items",
          "add",
          "quote-summit-001",
          "--product",
          "prod-aad-p1-0008",
          "--quantity",
          "1",
        ],
        {
          env: { ...process.env, PAX8_DEMO: "1", NO_COLOR: "1" },
        },
      );
      child.stdin.write("n\n");
      child.stdin.end();

      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d.toString()));
      const code: number = await new Promise((res) => child.on("close", res));
      expect(code).toBe(0);
      expect(stderr).toContain("Cancelled");
    });
  });

  describe("line-items remove", () => {
    it("removes a line item with -y", async () => {
      // The summit quote starts with 2 lines (li-summit-001-a, li-summit-001-b).
      // After remove, the next list call from the same subprocess would show 1,
      // but each runCli is a fresh subprocess (and demo data is in-memory),
      // so we just assert exit + JSON envelope here.
      const result = await runCliExpectSuccess([
        "quotes",
        "line-items",
        "remove",
        "quote-summit-001",
        "li-summit-001-b",
        "--json",
        "--yes",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]).toEqual({
        quoteId: "quote-summit-001",
        lineItemId: "li-summit-001-b",
        status: "Removed",
      });
    });

    it("errors with a clear message when the line item ID is wrong", async () => {
      const result = await runCliExpectFailure([
        "quotes",
        "line-items",
        "remove",
        "quote-summit-001",
        "li-bogus-999",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/not found/i);
      expect(combined).toMatch(/li-bogus-999/);
    });
  });

  describe("line-items --help", () => {
    it("shows subcommands in the line-items help", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "line-items",
        "--help",
      ]);
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("add");
      expect(result.stdout).toContain("remove");
    });

    it("includes Examples in the add help", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "line-items",
        "add",
        "--help",
      ]);
      expect(result.stdout).toContain("Examples:");
      expect(result.stdout).toContain("--product");
      expect(result.stdout).toContain("--quantity");
    });

    it("includes the --ids-only example in list help", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "line-items",
        "list",
        "--help",
      ]);
      expect(result.stdout).toContain("Examples:");
      expect(result.stdout).toContain("--ids-only");
    });
  });

  describe("line-items registers under quotes", () => {
    it("appears in `pax8 quotes --help`", async () => {
      const result = await runCli(["quotes", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("line-items");
    });
  });
});
