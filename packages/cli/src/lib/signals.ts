// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";
import { getTelemetry, ERROR_CANCELLED } from "@pax8/core";
import { stopAllActiveSpinners } from "./spinner.js";
import { recordWriteAudit } from "./write-audit.js";

// Injected at build time by the rollup config (see packages/cli/rollup.config.js).
declare const __CLI_VERSION__: string;

/**
 * In-flight write tracking for SIGINT cleanup.
 *
 * When a write command (orders create, subscriptions cancel, etc.) is about
 * to call the API it registers itself via `markWriteInFlight()`, then calls
 * the returned `done()` once the API call settles. If the user hits Ctrl+C
 * while a write is registered, the SIGINT handler emits a one-line hint to
 * stderr so they know to verify state.
 *
 * We only track the most recent write — concurrent writes from a single CLI
 * process aren't a thing, and the logging just needs *some* hint.
 */
interface InFlightWrite {
  resource: string;
  hint?: string;
  idempotencyKey?: string;
}

let currentWrite: InFlightWrite | null = null;

/**
 * Mark that a write to the given resource is in flight. Returns a `done`
 * function the caller MUST invoke (in a `finally`, ideally) when the write
 * settles — successful, failed, or otherwise.
 *
 * If the caller has computed an `idempotencyKey` for the request, pass it as
 * the third argument. The SIGINT handler will surface it in the cancellation
 * hint so the user can copy-paste a retry command instead of generating a new
 * key.
 *
 * Example:
 * ```ts
 * const done = markWriteInFlight("order", undefined, idempotencyKey);
 * try {
 *   await ctx.api.orders.create(...);
 * } finally {
 *   done();
 * }
 * ```
 */
export function markWriteInFlight(
  resource: string,
  hint?: string,
  idempotencyKey?: string,
): () => void {
  const entry: InFlightWrite = { resource, hint, idempotencyKey };
  currentWrite = entry;

  return () => {
    // Only clear if we're still the active entry — guards against a later
    // write that registered after us getting wiped by our late `done()`.
    if (currentWrite === entry) {
      // H-5: append a "completed" line to ~/.pax8/write-audit.log so the
      // operator has a local trail of every write the CLI attempted,
      // independent of telemetry opt-in. Best-effort — recordWriteAudit
      // swallows I/O failures so a full disk can't break a successful
      // write. The cancelled-via-SIGINT counterpart is logged in the
      // SIGINT handler below.
      recordWriteAudit({
        resource: entry.resource,
        outcome: "completed",
        idempotencyKey: entry.idempotencyKey,
      });
      currentWrite = null;
    }
  };
}

/** Internal — exposed for tests. */
export function _getWriteInFlight(): InFlightWrite | null {
  return currentWrite;
}

/** Internal — exposed for tests so they can reset module state. */
export function _resetWriteInFlight(): void {
  currentWrite = null;
}

let handlerInstalled = false;

/**
 * Install the top-level SIGINT handler. Idempotent — safe to call more than
 * once but only the first call wires anything up.
 *
 * Behavior on first SIGINT:
 *   1. Stop active spinners cleanly (no red `✗`).
 *   2. If a write was in flight, log a `(cancelled)` hint to stderr so the
 *      user knows to verify the resource state.
 *   3. Exit with code 130 (the conventional 128 + SIGINT(2)).
 *
 * On a second SIGINT we don't re-handle — Node's default takes over and the
 * process hard-exits. This matches user expectations: if the cleanup itself
 * is hung, a second Ctrl+C should always work.
 */
export function installSigintHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;

  let firstSigintSeen = false;

  process.on("SIGINT", () => {
    if (firstSigintSeen) {
      // Second Ctrl+C — get out of the way and let Node hard-exit.
      // We can't easily restore the default signal handler from JS, so
      // just exit immediately with the conventional code.
      process.exit(130);
      return;
    }
    firstSigintSeen = true;

    try {
      stopAllActiveSpinners();
    } catch {
      // Cleanup errors are not worth dying for.
    }

    const write = currentWrite;
    if (write) {
      // H-5: log the cancellation to ~/.pax8/write-audit.log before the
      // stderr hint, so even if the partner Ctrl+C-spams past the hint
      // they have an after-the-fact trail of what was in flight.
      recordWriteAudit({
        resource: write.resource,
        outcome: "cancelled",
        idempotencyKey: write.idempotencyKey,
      });
      const showCmd = `pax8 ${write.resource} show ...`;
      const extra = write.hint ? ` ${write.hint}` : "";
      const lines = [
        `(cancelled) Write was in flight. Run ${showCmd} to confirm state.${extra}`,
      ];
      if (write.idempotencyKey) {
        // Indent so the retry line visibly hangs under the cancelled line.
        lines.push(`            Retry with: --idempotency-key ${write.idempotencyKey}`);
      }
      const msg = lines.join("\n") + "\n";
      try {
        process.stderr.write(chalk.dim(msg));
      } catch {
        // If we can't even write to stderr there's nothing more we can do.
      }
    }

    // M-2: emit the cancellation audit event BEFORE the bounded flush so
    // PostHog actually receives it. Without this, a Ctrl+C during a write
    // never surfaces in the telemetry stream — the postAction hook never
    // runs, and the flush below would ship an empty buffer. Guard the
    // track() in try/catch because telemetry must never break exit.
    try {
      const telemetry = getTelemetry();
      if (telemetry.isEnabled()) {
        telemetry.track({
          event: "command_executed",
          command: "sigint",
          flags: [],
          duration_ms: 0,
          success: false,
          cancelled: true,
          error_code: ERROR_CANCELLED,
          cli_version: typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0",
          node_version: process.version,
          os: process.platform,
          demo_mode: process.env.PAX8_DEMO === "1",
        });
      }
    } catch {
      // Telemetry must never crash the SIGINT path.
    }

    // Best-effort telemetry flush before exit (#145). flushAndShutdown is a
    // no-op fast path when telemetry is disabled, so opt-out users pay no
    // latency. Bounded internally by a 1s timeout for the SIGINT path —
    // tighter than the regular error path because the user is actively
    // hitting Ctrl+C and expects an immediate exit.
    void getTelemetry()
      .flushAndShutdown(1000)
      .catch(() => {})
      .finally(() => process.exit(130));
  });
}
