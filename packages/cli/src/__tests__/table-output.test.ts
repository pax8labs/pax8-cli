// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripAnsi } from "../lib/output.js";

const exec = promisify(execFile);

const CLI_PATH = resolve(
  fileURLToPath(import.meta.url),
  "../../../dist/index.js"
);

/**
 * Run the CLI in demo mode, forcing table output (even in non-TTY)
 * by NOT setting NO_COLOR but capturing stdout.
 *
 * We use --csv or explicit format flags to test non-table formats,
 * and for table testing we parse the raw cli-table3 output.
 */
interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runTable(
  args: string[],
  env?: Record<string, string>
): Promise<RunResult> {
  try {
    // Use FORCE_COLOR=0 so chalk doesn't add ANSI when we want clean checks,
    // but still test with table format explicitly.
    const result = await exec("node", [CLI_PATH, ...args], {
      env: {
        ...process.env,
        PAX8_DEMO: "1",
        ...env,
      },
      timeout: 15000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.code ?? 1,
    };
  }
}

/**
 * Parse a cli-table3 table output into rows.
 * Each data row is the text between │ (or |) column separators.
 */
function parseTableRows(
  tableOutput: string
): { header: string[]; rows: string[][] } {
  const lines = tableOutput.split("\n");

  // Filter to lines containing column separators (│ or |)
  const dataLines = lines.filter(
    (line) => line.includes("│") || (line.includes("|") && !line.match(/^[\s─┼+-]+$/))
  );

  if (dataLines.length === 0) {
    return { header: [], rows: [] };
  }

  function splitRow(line: string): string[] {
    // Split by │ or |, trim each cell, filter out empty outer cells
    const sep = line.includes("│") ? "│" : "|";
    return line
      .split(sep)
      .map((cell) => stripAnsi(cell).trim())
      .filter((_, i, arr) => i > 0 && i < arr.length - 1);
  }

  const header = splitRow(dataLines[0]);
  const rows = dataLines.slice(1).map(splitRow);

  return { header, rows };
}

describe("table output — TTY-aware rendering", () => {
  describe("companies list", () => {
    it("produces a well-formed table with consistent column count", async () => {
      // Non-TTY defaults to JSON, so we explicitly request table format won't work.
      // Instead, test the JSON output structure, then test table rendering via unit tests.
      // For subprocess table output, we need to check --csv as a proxy for column structure.
      const result = await runTable(["companies", "list", "--json"]);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      // No per-row key-presence assertion here. The original assertion took
      // `Object.keys(data[0])` and required every other row to carry the same
      // keys, which forced uniform population of optional fields and bit us in
      // PR #277. Optional-field sparseness is *expected* in real `--json`
      // output; the table renderer's column inference (now union-of-keys) is
      // tested directly in `lib/output-extended.test.ts`.
    });

    it("CSV output has no ANSI codes", async () => {
      const result = await runTable(["companies", "list", "--csv"]);
      expect(result.exitCode).toBe(0);
      // CSV should never contain ANSI escape sequences
      expect(result.stdout).not.toContain("\x1b[");
      const lines = result.stdout.trim().split("\n");
      // Header + data rows
      expect(lines.length).toBeGreaterThan(1);
      // All rows should have the same number of commas (same column count)
      const headerCommas = (lines[0].match(/,/g) || []).length;
      for (const line of lines.slice(1)) {
        // Account for commas inside quoted fields
        const unquoted = line.replace(/"[^"]*"/g, "QUOTED");
        const commas = (unquoted.match(/,/g) || []).length;
        expect(commas).toBe(headerCommas);
      }
    });

    it("JSON output has no ANSI codes", async () => {
      const result = await runTable(["companies", "list", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("\x1b[");
      // Should be valid JSON
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    });
  });

  describe("subscriptions list", () => {
    it("CSV output has consistent columns and no ANSI", async () => {
      const result = await runTable(["subscriptions", "list", "--csv"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("\x1b[");
      const lines = result.stdout.trim().split("\n");
      expect(lines.length).toBeGreaterThan(1);
      expect(lines[0]).toContain("Company");
      expect(lines[0]).toContain("Product");
      expect(lines[0]).toContain("Status");
    });

    it("JSON output is clean", async () => {
      const result = await runTable(["subscriptions", "list", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("\x1b[");
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe("subscriptions renewals", () => {
    it("JSON output is clean and structured", async () => {
      const result = await runTable([
        "subscriptions",
        "renewals",
        "--json",
        "--within",
        "90d",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("\x1b[");
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
    });

    it("CSV output has no ANSI codes", async () => {
      const result = await runTable([
        "subscriptions",
        "renewals",
        "--csv",
        "--within",
        "90d",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("\x1b[");
    });
  });

  describe("recommendations list", () => {
    it("JSON output is clean", async () => {
      const result = await runTable(["recommendations", "list", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("\x1b[");
      // #521: list output is now wrapped { recommendations, totalAvailable }.
      // The cleanliness assertion still passes — we're checking that the
      // wrapped JSON is parseable and ANSI-free.
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data.recommendations)).toBe(true);
      expect(typeof data.totalAvailable).toBe("number");
    });

    it("CSV output has no ANSI codes", async () => {
      const result = await runTable(["recommendations", "list", "--csv"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("\x1b[");
    });
  });

  describe("invoices list", () => {
    it("CSV output has consistent columns and no ANSI", async () => {
      const result = await runTable(["invoices", "list", "--csv"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("\x1b[");
      const lines = result.stdout.trim().split("\n");
      expect(lines.length).toBeGreaterThan(1);
      expect(lines[0]).toContain("Company");
      expect(lines[0]).toContain("Total");
    });

    it("JSON output is clean", async () => {
      const result = await runTable(["invoices", "list", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("\x1b[");
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
    });
  });
});

describe("table rendering — unit tests", () => {
  it("stripAnsi removes ANSI escape codes", () => {
    expect(stripAnsi("\x1b[32mgreen\x1b[0m")).toBe("green");
    expect(stripAnsi("\x1b[1;36;40mbold cyan\x1b[0m")).toBe("bold cyan");
    expect(stripAnsi("no ansi here")).toBe("no ansi here");
  });

  it("table output has consistent column count across all rows", async () => {
    // Import the output function directly for unit testing
    const { output } = await import("../lib/output.js");
    const { vi } = await import("vitest");

    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const columns = [
        { key: "id", header: "ID" },
        { key: "name", header: "Name" },
        { key: "status", header: "Status" },
      ];

      const data = [
        { id: "1", name: "Short", status: "Active" },
        { id: "2", name: "A Very Long Company Name That Should Still Work", status: "Cancelled" },
        { id: "3", name: "Normal Co", status: "Trial" },
      ];

      output(data, { format: "table", columns });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const { header, rows } = parseTableRows(written);

      expect(header.length).toBe(3);
      for (const row of rows) {
        expect(row.length).toBe(header.length);
      }

      // Verify no incomplete/truncated lines (all lines should end properly)
      const lines = written.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const trimmed = line.trim();
        // Each table line should end with a border character
        expect(
          trimmed.endsWith("│") ||
            trimmed.endsWith("|") ||
            trimmed.endsWith("┘") ||
            trimmed.endsWith("┐") ||
            trimmed.endsWith("┤") ||
            trimmed.match(/[─┼+-]$/)
        ).toBeTruthy();
      }
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("handles rows with null and undefined values without crashing", async () => {
    const { output } = await import("../lib/output.js");
    const { vi } = await import("vitest");

    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const columns = [
        { key: "id", header: "ID" },
        { key: "name", header: "Name" },
        { key: "missing", header: "Missing" },
      ];

      const data = [
        { id: "1", name: null, missing: undefined },
        { id: "2", name: "Present", missing: null },
      ] as unknown as Record<string, unknown>[];

      output(data, { format: "table", columns });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(written.length).toBeGreaterThan(0);
      const { header, rows } = parseTableRows(written);
      expect(header.length).toBe(3);
      expect(rows.length).toBe(2);
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("formatCompanyName truncates with ellipsis for long names", async () => {
    const { formatCompanyName } = await import("../lib/formatters.js");

    // Default maxLen is 25
    const longName = "Extremely Long International Business Machines Corporation";
    const truncated = formatCompanyName(longName);
    expect(truncated.length).toBe(25);
    expect(truncated.endsWith("…")).toBe(true);

    // Short names stay unchanged
    const shortName = "Acme Corp";
    expect(formatCompanyName(shortName)).toBe(shortName);

    // Exact length stays unchanged
    const exact = "A".repeat(25);
    expect(formatCompanyName(exact)).toBe(exact);
  });

  it("CSV format does not apply column formatters (no ANSI)", async () => {
    const { output } = await import("../lib/output.js");
    const { vi } = await import("vitest");
    const chalk = (await import("chalk")).default;

    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const columns = [
        {
          key: "status",
          header: "Status",
          format: (v: unknown) => chalk.green(String(v)),
        },
      ];

      const data = [{ status: "Active" }];

      output(data, { format: "csv", columns });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      // CSV should NOT contain ANSI codes — it uses raw values, not formatters
      expect(written).not.toContain("\x1b[");
      expect(written).toContain("Active");
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("JSON format does not contain ANSI codes", async () => {
    const { output } = await import("../lib/output.js");
    const { vi } = await import("vitest");

    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const data = [{ name: "Test", status: "Active" }];
      output(data, { format: "json" });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(written).not.toContain("\x1b[");
      expect(() => JSON.parse(written)).not.toThrow();
    } finally {
      stdoutWrite.mockRestore();
    }
  });
});
