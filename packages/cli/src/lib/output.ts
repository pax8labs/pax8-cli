// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";
import Table from "cli-table3";

export interface Column {
  key: string;
  header: string;
  width?: number;
  /**
   * Cell formatter. The optional second argument is the full row; pass it
   * when the cell needs sibling fields (e.g. price + currencyCode where the
   * currency code is a separate column on the wire but rendered inline with
   * the price). Most formatters ignore it.
   */
  format?: (value: unknown, row?: Record<string, unknown>) => string;
}

export interface OutputOptions {
  format: "table" | "json" | "csv" | "quiet";
  columns?: Column[];
}

function escapeCSV(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Strip ANSI escape sequences from a string to get its visible length.
 */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

/**
 * Get the effective terminal width, accounting for the 2-char indent we add.
 * Returns Infinity when not running in a TTY (no wrapping needed).
 */
export function getTerminalWidth(): number {
  if (process.stdout.columns && process.stdout.columns > 0) {
    // Subtract 2 for the indent we add to every table line
    return process.stdout.columns - 2;
  }
  return Infinity;
}

function formatTable(data: readonly Record<string, unknown>[], columns: Column[]): void {
  const termWidth = getTerminalWidth();

  // Build column widths: use explicit widths where specified,
  // and let cli-table3 auto-size the rest. If the total exceeds
  // terminal width, we'll set wordWrap to prevent overflow.
  const colWidths = columns.map((col) => col.width ?? null);
  const wrapEnabled = termWidth < Infinity;

  const table = new Table({
    head: columns.map((col) => chalk.cyan.bold(col.header)),
    style: {
      head: [],
      border: [],
      "padding-left": 1,
      "padding-right": 1,
    },
    // Drop the inter-row dividers. The bold/cyan header is enough visual
    // separation; per-row dividers double the line count for no information
    // value (gh, k9s, fly, stripe all render this way). The outer box stays.
    chars: {
      mid: "",
      "left-mid": "",
      "mid-mid": "",
      "right-mid": "",
    },
    colWidths,
    wordWrap: wrapEnabled,
  });

  for (const row of data) {
    table.push(
      columns.map((col) => {
        const raw = row[col.key];
        const value = raw === undefined || raw === null ? "" : raw;
        return col.format ? col.format(value, row) : String(value);
      })
    );
  }

  // Two-space indent for table output
  const lines = table.toString().split("\n");
  for (const line of lines) {
    process.stdout.write("  " + line + "\n");
  }
}

function formatJSON(data: readonly Record<string, unknown>[]): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function formatCSV(data: readonly Record<string, unknown>[], columns: Column[]): void {
  // Header row
  const header = columns.map((col) => escapeCSV(col.header)).join(",");
  process.stdout.write(header + "\n");

  // Data rows
  for (const row of data) {
    const line = columns
      .map((col) => {
        const raw = row[col.key];
        const value = raw === undefined || raw === null ? "" : String(raw);
        return escapeCSV(value);
      })
      .join(",");
    process.stdout.write(line + "\n");
  }
}

/**
 * Render `data` to stdout in the format selected by `options`.
 *
 * The parameter type is intentionally widened to `readonly object[]` so that
 * callers can pass typed domain rows (e.g. `Subscription[]`, `Invoice[]`)
 * without having to assert `as Record<string, unknown>[]`. Internally we
 * treat each row as a string-keyed bag for `columns[i].format(row[col.key])`
 * lookups, which is safe for any plain object.
 */
export function output(data: readonly object[], options: OutputOptions): void {
  const { format, columns } = options;

  // Treat each row as a generic string-keyed bag for column lookups.
  const rows = data as readonly Record<string, unknown>[];

  if (format === "quiet") {
    return;
  }

  if (format === "json") {
    formatJSON(rows);
    return;
  }

  if (!columns || columns.length === 0) {
    if (format === "table") {
      // Fallback: show as JSON if no columns defined
      formatJSON(rows);
    } else if (format === "csv") {
      // Infer columns from first item
      if (rows.length > 0) {
        const inferred: Column[] = Object.keys(rows[0]).map((key) => ({
          key,
          header: key,
        }));
        formatCSV(rows, inferred);
      }
    }
    return;
  }

  if (format === "table") {
    formatTable(rows, columns);
  } else if (format === "csv") {
    formatCSV(rows, columns);
  }
}
