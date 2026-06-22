// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";

/**
 * Aggregator-feed identifier. Both `today` and `dashboard` fetch a small
 * fixed set of feeds in parallel via `Promise.allSettled`; when one rejects,
 * the command degrades gracefully and emits a per-feed warning to stderr.
 *
 * Keeping the union tight (rather than `string`) lets callers exhaustively
 * map per-feed messages and lets agents reading stderr disambiguate which
 * feed degraded.
 */
export type FeedName =
  | "subscriptions"
  | "companies"
  | "products"
  | "invoices"
  | "orders";

/**
 * Structured warning emitted by the fetch layer when a single feed fails.
 *
 * The fetch helper returns these as data instead of writing them to stderr
 * directly so the helper is unit-testable in isolation. The command layer
 * (`runToday`, `runDashboard`) is responsible for emitting them via
 * `emitWarnings()` at the appropriate point in the run sequence.
 *
 * NOTE: per #635, these warnings are stderr-only — they are intentionally
 * NOT surfaced on the JSON envelope. Whether to add `warnings[]` to the
 * JSON contract is a separate decision; refer to the issue body.
 */
export interface WarningRecord {
  feed: FeedName;
  severity: "warn" | "error";
  message: string;
}

/**
 * Format a single warning record as a chalk-coloured stderr line. The
 * line matches the pre-refactor inline shape (whole string coloured, two-
 * space indent, severity glyph prefix, trailing newline) so observable
 * behaviour is identical to the prior `process.stderr.write(chalk.yellow(...))`
 * calls in `today.ts` / `dashboard.ts`.
 *
 *   - severity "warn"  → yellow "  ⚠ <message>\n"
 *   - severity "error" → red    "  ✗ <message>\n"
 *
 * Exported so tests can assert formatting without spawning a subprocess.
 */
export function formatWarning(w: WarningRecord): string {
  const glyph = w.severity === "error" ? "✗" : "⚠";
  const colour = w.severity === "error" ? chalk.red : chalk.yellow;
  return colour(`  ${glyph} ${w.message}`) + "\n";
}

/**
 * Emit a list of warning records to a stderr-style stream.
 *
 * The fetch helper returns warnings as data; the command layer calls this
 * to surface them. Stderr is the side channel — the JSON stdout envelope
 * is unaffected (callers can still emit warnings even under `--json`).
 */
export function emitWarnings(
  stream: NodeJS.WritableStream,
  warnings: readonly WarningRecord[],
): void {
  for (const w of warnings) {
    stream.write(formatWarning(w));
  }
}
