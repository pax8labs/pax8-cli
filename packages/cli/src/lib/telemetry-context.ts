// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { TelemetryEvent } from "@pax8/core";

/**
 * Request-scoped telemetry fields contributed by command handlers.
 *
 * Background (#146): Most commands fire exactly one `command_executed` event
 * via the program-level `postAction` hook in `index.ts`. A handful of write
 * commands (`recommendations act`, `orders create`) used to call
 * `getTelemetry().track()` directly to attach aggregate counters
 * (`recs_mrr_captured`, `order_total_dollars`, `order_seats`, etc.) the
 * generic hook didn't know about. That double-fired the event with two
 * different `command` shapes (top-level vs dotted), corrupting any
 * `count(*) GROUP BY command` analysis in PostHog.
 *
 * The fix: handlers write the extra fields here via `setTelemetryFields`,
 * and the `postAction` hook drains them via `consumeTelemetryFields` and
 * merges them into its single canonical `track()` call. One event per
 * command run, with all the props.
 *
 * Scope is process-global because only one Commander action runs per CLI
 * invocation. We `consume` (read + reset) inside postAction so a long-lived
 * REPL parent process can't accidentally leak fields from one subprocess to
 * the next.
 */

/**
 * Aggregate-count fields that handlers may contribute to the postAction
 * event. Constrained to the seven keys actually defined on `TelemetryEvent`
 * today so a future drive-by can't add free-form text to the schema —
 * widen this `Pick` set when a new field is added to `TelemetryEvent`.
 */
export type TelemetryExtraFields = Partial<
  Pick<
    TelemetryEvent,
    | "order_success"
    | "order_total_dollars"
    | "order_mrr_impact"
    | "order_seats"
    | "order_dry_run"
    | "order_line_count"
    | "recs_presented"
    | "recs_ordered"
    | "recs_skipped"
    | "recs_mrr_captured"
  >
>;

let pending: Record<string, unknown> = {};

/**
 * Merge additional telemetry fields into the pending event. Safe to call
 * multiple times in one command run — later calls win on key collision,
 * matching `Object.assign` semantics. Pass `undefined` to explicitly omit
 * (callers that compute optional values can pass them through without an
 * `if`).
 */
export function setTelemetryFields(fields: TelemetryExtraFields): void {
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) {
      pending[k] = v;
    }
  }
}

/**
 * Take and clear the pending fields. Returns a fresh object the caller
 * owns; the internal state is reset to empty so the next command starts
 * clean.
 */
export function consumeTelemetryFields(): Record<string, unknown> {
  const out = pending;
  pending = {};
  return out;
}

/** Test hook — reset state without consuming. */
export function _resetTelemetryFields(): void {
  pending = {};
}

/**
 * Metadata about the command currently being executed. Stashed by the
 * program-level `preAction` hook so the failure path (`handleCommandError`)
 * can emit a `command_executed { success: false }` event without needing
 * the Commander `actionCommand` it doesn't have direct access to. Cleared
 * by either the `postAction` hook (success path) or `handleCommandError`
 * (failure path) so it never leaks across commands in a long-lived REPL
 * parent process.
 */
export interface ActiveCommandContext {
  command: string;
  subcommand: string;
  flags: string[];
  startTime: number;
}

let active: ActiveCommandContext | null = null;

export function setActiveCommand(ctx: ActiveCommandContext): void {
  active = ctx;
}

/**
 * Read + clear the active command context. Returns `null` if no command
 * is currently active (e.g. a Commander parse error before any action
 * dispatched). Caller is responsible for clearing — this consume pattern
 * matches `consumeTelemetryFields`.
 */
export function consumeActiveCommand(): ActiveCommandContext | null {
  const out = active;
  active = null;
  return out;
}

/** Test hook — reset without consuming. */
export function _resetActiveCommand(): void {
  active = null;
}
