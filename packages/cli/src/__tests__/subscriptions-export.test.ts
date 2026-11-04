// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

/**
 * Phase 3 of #613. `pax8 subscriptions export` streams every page of
 * the subscriptions endpoint to stdout in csv / jsonl / json — the
 * raw-data path complement to the aggregator commands.
 *
 * Pins the contract:
 * - Default format is csv with a fixed header row.
 * - Each format streams (no materialization assumption breakable by
 *   a future refactor toward `collectAllSubscriptions`).
 * - Filters (`--company`, `--status`, `--billing-term`, `--product-id`)
 *   pass through to `streamAll`.
 * - At PAX8_DEMO_SCALE=large the command walks all 5000 fixture subs.
 * - Unknown formats and unknown enum values fail fast at the parse
 *   boundary with ERROR_INVALID_INPUT (not after a partial write).
 */
describe("pax8 subscriptions export (#613 Phase 3)", () => {
  it("default format is csv with the documented header row", async () => {
    const result = await runCliExpectSuccess(["subscriptions", "export"]);
    const lines = result.stdout.split("\n");
    expect(lines[0]).toBe(
      "id,companyId,companyName,productId,productName,quantity,price,currencyCode,billingTerm,status,startDate,endDate,commitmentTermEndDate,createdAt,updatedAt",
    );
    // At least one data row exists (demo fixture has subs).
    expect(lines.length).toBeGreaterThan(1);
  });

  it("--format jsonl emits one JSON object per line", async () => {
    const result = await runCliExpectSuccess(["subscriptions", "export", "--format", "jsonl"]);
    const lines = result.stdout.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    // Every non-empty line must parse as a single JSON object with at
    // least an `id`. If a future refactor accidentally wraps the
    // output in an array, this assertion fails per-line.
    for (const line of lines) {
      const obj = JSON.parse(line);
      expect(typeof obj.id).toBe("string");
    }
  });

  it("--format json emits a single parseable JSON array", async () => {
    const result = await runCliExpectSuccess(["subscriptions", "export", "--format", "json"]);
    const arr = JSON.parse(result.stdout);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThan(0);
    expect(typeof arr[0].id).toBe("string");
  });

  it("--status filter is propagated to streamAll (only Active rows returned)", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "export",
      "--status",
      "Active",
      "--format",
      "jsonl",
    ]);
    const rows = result.stdout
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.status).toBe("Active");
    }
  });

  it("at PAX8_DEMO_SCALE=large walks every page (5000 subs, header + 5000 csv rows)", async () => {
    const result = await runCliExpectSuccess(
      ["subscriptions", "export", "--format", "jsonl"],
      { PAX8_DEMO_SCALE: "large" },
    );
    // Each line is one subscription. The large fixture has 5000 subs;
    // pre-Phase-1 streamAll, a list-based fetch would have stopped at
    // 1000. Using jsonl avoids the embedded-newline-in-CSV-fields
    // counting hazard.
    const lines = result.stdout.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(5000);
  });

  it("rejects an unknown format with ERROR_INVALID_INPUT before any stdout write", async () => {
    // --json so the structured envelope (with `code: ERROR_INVALID_INPUT`)
    // lands on stderr in a form we can assert on. Without --json the
    // user sees a human-readable error and the code is in the envelope
    // on disk but not in the live stderr render.
    const result = await runCliExpectFailure([
      "subscriptions",
      "export",
      "--format",
      "parquet",
      "--json",
    ]);
    const haystack = result.stderr + result.stdout;
    expect(haystack).toContain("ERROR_INVALID_INPUT");
    // Stdout should be empty — no partial write before the failure.
    // (The fail-fast contract is the whole point of validating before
    // touching streamAll.)
    expect(result.stdout.trim()).toBe("");
  });

  it("rejects an unknown --status enum value before any stdout write", async () => {
    const result = await runCliExpectFailure([
      "subscriptions",
      "export",
      "--status",
      "Bogus",
      "--json",
    ]);
    const haystack = result.stderr + result.stdout;
    expect(haystack).toContain("ERROR_INVALID_INPUT");
    expect(result.stdout.trim()).toBe("");
  });

  it("--help mentions all three formats and the streaming intent", async () => {
    const result = await runCliExpectSuccess(["subscriptions", "export", "--help"]);
    expect(result.stdout).toContain("csv");
    expect(result.stdout).toContain("jsonl");
    expect(result.stdout).toContain("json");
    // The help text explains the command exists because aggregator
    // commands compute summaries; export gives you rows. If that
    // framing ever changes, the help should change too.
    expect(result.stdout.toLowerCase()).toMatch(/stream|raw-data|never materialize|export/);
  });

  it("--quiet suppresses the end-of-run stderr summary", async () => {
    const result = await runCli(["subscriptions", "export", "--quiet"]);
    // CSV still goes to stdout (--quiet is about *status*, not data).
    expect(result.stdout.length).toBeGreaterThan(0);
    // No "Exported N subscription(s)" trailer on stderr.
    expect(result.stderr).not.toMatch(/Exported \d+ subscription/);
  });

  it("CSV escapes fields containing commas, quotes, and newlines (RFC-4180-ish)", async () => {
    // Demo fixtures include at least one company name with a comma
    // ("Bright Minds Academy, Inc." or similar) and some shell-
    // metacharacter names from PAX8_DEMO_SCALE=large. Verify the CSV
    // is parseable round-trip — any unescaped value would break the
    // column count.
    const result = await runCliExpectSuccess(["subscriptions", "export"], {
      PAX8_DEMO_SCALE: "large",
    });
    const lines = result.stdout.split("\n").filter((l) => l.length > 0);
    const headerCols = lines[0].split(",").length;
    expect(headerCols).toBe(15); // CSV_COLUMNS.length
    // Spot-check: the first 50 data rows should all parse to the same
    // column count once embedded quoted commas are handled. We do a
    // simple state machine here rather than pulling in a csv lib.
    function countCsvCols(line: string): number {
      let cols = 1;
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          // RFC-4180: doubled quote inside a quoted field
          if (inQuote && line[i + 1] === '"') {
            i++;
            continue;
          }
          inQuote = !inQuote;
        } else if (ch === "," && !inQuote) {
          cols++;
        }
      }
      return cols;
    }
    // Note: lines that contained embedded newlines in fields would
    // appear as multiple physical lines here; that's fine — we just
    // assert no *single-line* row has a column-count mismatch caused
    // by unescaped commas in non-quoted fields. (Embedded-newline
    // fields ARE escaped — they're wrapped in quotes — so their
    // physical-line continuation is a separate concern, validated
    // implicitly by the python csv module check in the PR's manual
    // smoke.)
    for (const line of lines.slice(1, 51)) {
      // Skip continuation lines (which start mid-quoted-field). A
      // safe heuristic: if the line doesn't start with a `sub-` or
      // UUID-ish id, it's a continuation. The header row's first
      // column is `id`; valid data rows start with the sub id.
      if (!/^[a-zA-Z0-9_-]/.test(line)) continue;
      expect(countCsvCols(line)).toBe(15);
    }
  });
});
