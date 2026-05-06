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

let pending: Record<string, unknown> = {};

/**
 * Merge additional telemetry fields into the pending event. Safe to call
 * multiple times in one command run — later calls win on key collision,
 * matching `Object.assign` semantics. Pass `undefined` to explicitly omit
 * (callers that compute optional values can pass them through without an
 * `if`).
 */
export function setTelemetryFields(fields: Record<string, unknown>): void {
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
