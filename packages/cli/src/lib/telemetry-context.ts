// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { CredentialStore, getTelemetry, type TelemetryEvent } from "@pax8/core";

/**
 * Resolve the partner-account group key for the current process and set it on
 * the telemetry singleton, so **every** emit path attaches the same `account`
 * group: the success `postAction` hook, the failure handler
 * (`emitFailureEvent`), and — critically — the SIGINT handler in `signals.ts`,
 * which emits a `command_executed` event directly and previously shipped it
 * with a null group.
 *
 * This is the single startup seam for account attribution. `posthog-node` is
 * stateless — there is no persistent session `group()` call as in the browser
 * `posthog-js` SDK — so `Telemetry.flush()` must stamp `groups` onto each
 * captured event. Setting the key once here, from the `preAction` hook before
 * any event is captured, is what makes that stamping reliable regardless of
 * which code path ends up emitting. Scattering per-emit-site `setAccount`
 * calls (the prior approach) let paths be missed.
 *
 * Best-effort and never throws: a credential-read failure just leaves the
 * account unset, so events fall back to the anonymous per-install
 * `distinct_id` only. Only a salted hash of the `clientId` is ever retained —
 * see `Telemetry.setAccount()` / `accountGroupKey()`. Uncredentialed and demo
 * runs resolve to `null` (no group).
 */
export async function resolveTelemetryAccount(): Promise<void> {
  try {
    const creds = await new CredentialStore().getCredentials();
    getTelemetry().setAccount(creds?.clientId ?? null);
  } catch {
    getTelemetry().setAccount(null);
  }
}

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
    | "upgrade_action"
    | "upgrade_method"
    | "upgrade_from"
    | "upgrade_to"
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
