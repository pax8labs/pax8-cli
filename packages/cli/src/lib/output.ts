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

/**
 * A suggestion rendered under the empty-state message as a copy-pasteable
 * command. The CLI command is shown in cyan; the description in dim text.
 */
export interface EmptyStateSuggestion {
  /** Shell-runnable command, e.g. `pax8 companies create --name "Acme"`. */
  command: string;
  /** Short hint describing what the command does. */
  description: string;
}

/**
 * Replaces an empty data table with a clear, helpful message. Rendered to
 * stderr only when `format === "table"` and `data.length === 0`. JSON / CSV /
 * quiet / ids-only outputs are unaffected — agents and pipelines still see
 * the empty-array contract.
 */
export interface EmptyState {
  /** Headline shown in place of the table, e.g. "No companies found." */
  headline: string;
  /** Optional bullet list explaining why the list might be empty. */
  reasons?: string[];
  /** Optional "Try next:" block with copy-pasteable commands. */
  suggestions?: EmptyStateSuggestion[];
}

export interface OutputOptions {
  format: "table" | "json" | "csv" | "quiet";
  columns?: Column[];
  /**
   * Replaces the empty-table fallback with a helpful message when the data
   * array is empty AND `format === "table"`. Other formats ignore this — JSON
   * still returns `[]`, CSV still returns a header row, quiet still no-ops.
   *
   * If omitted, the legacy empty-table behavior is preserved for backward
   * compatibility (caller hasn't migrated).
   */
  emptyState?: EmptyState;
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
 * Build a `Column[]` by walking every row and collecting unique keys in
 * first-encounter order.
 *
 * Earlier code inferred columns from `Object.keys(rows[0])`, which assumes
 * the first row is canonical. With realistic data (some entries populating
 * optional fields, others not), that meant the column set could flicker
 * based on sort order. Walking the union closes the gap without imposing
 * uniformity on the underlying records.
 *
 * Returns an empty array when `rows` is empty.
 */
function inferColumns(rows: readonly Record<string, unknown>[]): Column[] {
  const seen = new Set<string>();
  const orderedKeys: string[] = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        orderedKeys.push(k);
      }
    }
  }
  return orderedKeys.map((key) => ({ key, header: key }));
}

/**
 * Render the supplied `emptyState` to stderr. Used in place of an empty table
 * — printing a header + divider with no body lines reads as "something is
 * broken" rather than "you have zero rows." Stderr (not stdout) so pipelines
 * using `--json | jq` aren't affected by the human-facing hint.
 */
function renderEmptyState(state: EmptyState): void {
  process.stderr.write("\n  " + state.headline + "\n");

  if (state.reasons && state.reasons.length > 0) {
    process.stderr.write("\n" + chalk.dim("  Possible reasons:\n"));
    for (const reason of state.reasons) {
      process.stderr.write(chalk.dim(`    • ${reason}\n`));
    }
  }

  if (state.suggestions && state.suggestions.length > 0) {
    process.stderr.write("\n" + chalk.dim("  Try next:\n"));
    for (const s of state.suggestions) {
      process.stderr.write(
        `    ${chalk.cyan(s.command)}  ${chalk.dim(s.description)}\n`,
      );
    }
  }

  process.stderr.write("\n");
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
  const { format, columns, emptyState } = options;

  // Treat each row as a generic string-keyed bag for column lookups.
  const rows = data as readonly Record<string, unknown>[];

  if (format === "quiet") {
    return;
  }

  if (format === "json") {
    formatJSON(rows);
    return;
  }

  // Empty-state replacement applies only to human-facing table output.
  // JSON returns `[]`, CSV returns a header-only row, quiet stays silent —
  // those are the stable contracts that pipelines and agents depend on.
  if (format === "table" && rows.length === 0 && emptyState) {
    renderEmptyState(emptyState);
    return;
  }

  if (!columns || columns.length === 0) {
    if (format === "table") {
      // Fallback: show as JSON if no columns defined
      formatJSON(rows);
    } else if (format === "csv") {
      // Infer columns from the union of keys across all rows, in
      // first-encounter order. Walking the union (rather than `rows[0]`)
      // means rows with sparsely populated optional fields don't cause the
      // column list to flicker based on which row sorts first.
      const inferred = inferColumns(rows);
      if (inferred.length > 0) {
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
