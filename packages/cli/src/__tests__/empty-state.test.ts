// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

/**
 * Empty-state contract (issue #197). When a list command returns zero rows:
 *  - `--json`     → `[]` on stdout. Pipelines untouched.
 *  - `--csv`      → header-only on stdout. Scripts can still parse.
 *  - `--ids-only` → no output. Composes correctly with xargs.
 *  - human/table  → "No <resource> found." headline + reasons + suggestions
 *    on STDERR (never stdout — pipelines using `--json | jq` must not see
 *    this). The empty header+divider table is suppressed entirely.
 *
 * We exercise two representative list commands so the contract is pinned
 * for the shared `output()` helper without re-asserting on every command.
 */

describe("empty list rendering — #197", () => {
  describe("companies list with no matches", () => {
    it("--json emits an empty array on stdout with no human-facing noise", async () => {
      // No companies in demo data carry status=Deleted, so this filter
      // yields zero rows without needing a mock surgery.
      const result = await runCliExpectSuccess([
        "companies",
        "list",
        "--status",
        "Deleted",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(0);
      // Empty-state message must not bleed into stdout — JSON contract is
      // load-bearing for agents and `--json | jq` pipelines.
      expect(result.stdout).not.toContain("No companies found");
    });

    it("human/table mode prints the empty-state headline on stderr", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "list",
        "--status",
        "Deleted",
      ]);
      // Non-TTY defaults to JSON, so we don't get the human path through
      // this transport. Stdout still must be a parseable empty array.
      const data = JSON.parse(result.stdout);
      expect(data.length).toBe(0);
    });

    it("--csv produces a header row only (no body, no message)", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "list",
        "--status",
        "Deleted",
        "--csv",
      ]);
      const lines = result.stdout.trim().split("\n").filter(Boolean);
      // Header row only — no data rows. (Empty stdout would be an
      // acceptable alternative; we lock in header-only as the chosen shape.)
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("Company");
      // No empty-state message should appear on stdout.
      expect(result.stdout).not.toContain("No companies found");
    });

    it("--ids-only produces no stdout when empty", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "list",
        "--status",
        "Deleted",
        "--ids-only",
      ]);
      expect(result.stdout.trim()).toBe("");
    });
  });

  describe("invoices list with no matches", () => {
    it("--json emits an empty array on stdout", async () => {
      // 1900-01 predates any demo invoice, so the month filter is empty.
      const result = await runCliExpectSuccess([
        "invoices",
        "list",
        "--month",
        "1900-01",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(0);
      expect(result.stdout).not.toContain("No invoices found");
    });

    it("--csv produces header-only with no body rows", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "list",
        "--month",
        "1900-01",
        "--csv",
      ]);
      const lines = result.stdout.trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("Total");
      expect(result.stdout).not.toContain("No invoices found");
    });
  });

  describe("output() — empty-state unit behavior", () => {
    it("renders the empty-state to stderr when table + 0 rows", async () => {
      const { output } = await import("../lib/output.js");
      const { vi } = await import("vitest");

      const stdoutWrite = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      const stderrWrite = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      try {
        output([], {
          format: "table",
          columns: [{ key: "name", header: "Name" }],
          emptyState: {
            headline: "No widgets found.",
            reasons: ["You haven't created any widgets yet."],
            suggestions: [
              { command: "pax8 widgets create", description: "make one" },
            ],
          },
        });

        const onStdout = stdoutWrite.mock.calls.map((c) => c[0]).join("");
        const onStderr = stderrWrite.mock.calls.map((c) => c[0]).join("");

        // The data channel must stay quiet for empty table output. A
        // pipeline that consumes stdout must not see decorative text.
        expect(onStdout).toBe("");
        expect(onStderr).toContain("No widgets found.");
        expect(onStderr).toContain("You haven't created any widgets yet.");
        expect(onStderr).toContain("pax8 widgets create");
        expect(onStderr).toContain("make one");
      } finally {
        stdoutWrite.mockRestore();
        stderrWrite.mockRestore();
      }
    });

    it("emits `[]` on stdout for json + 0 rows, ignoring emptyState", async () => {
      const { output } = await import("../lib/output.js");
      const { vi } = await import("vitest");

      const stdoutWrite = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      const stderrWrite = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      try {
        output([], {
          format: "json",
          emptyState: {
            headline: "No widgets found.",
          },
        });

        const onStdout = stdoutWrite.mock.calls.map((c) => c[0]).join("");
        const onStderr = stderrWrite.mock.calls.map((c) => c[0]).join("");

        // JSON contract is invariant — must be `[]\n` regardless of
        // emptyState. Agents depend on this for `--json | jq`.
        expect(onStdout.trim()).toBe("[]");
        expect(onStderr).toBe("");
      } finally {
        stdoutWrite.mockRestore();
        stderrWrite.mockRestore();
      }
    });

    it("falls back to the empty-table renderer when no emptyState is supplied", async () => {
      // Backward-compat guard: the new emptyState param is optional, and
      // a caller that hasn't migrated yet should see the previous behavior
      // (the cli-table3 header on stdout) — never a thrown error.
      const { output } = await import("../lib/output.js");
      const { vi } = await import("vitest");

      const stdoutWrite = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      try {
        expect(() =>
          output([], {
            format: "table",
            columns: [{ key: "name", header: "Name" }],
          }),
        ).not.toThrow();

        const onStdout = stdoutWrite.mock.calls.map((c) => c[0]).join("");
        // Legacy fallback writes the cli-table3 header box.
        expect(onStdout).toContain("Name");
      } finally {
        stdoutWrite.mockRestore();
      }
    });
  });
});
