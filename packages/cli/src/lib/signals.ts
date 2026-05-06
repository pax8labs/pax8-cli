import chalk from "chalk";
import { stopAllActiveSpinners } from "./spinner.js";

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
}

let currentWrite: InFlightWrite | null = null;

/**
 * Mark that a write to the given resource is in flight. Returns a `done`
 * function the caller MUST invoke (in a `finally`, ideally) when the write
 * settles — successful, failed, or otherwise.
 *
 * Example:
 * ```ts
 * const done = markWriteInFlight("order");
 * try {
 *   await ctx.api.orders.create(...);
 * } finally {
 *   done();
 * }
 * ```
 */
export function markWriteInFlight(resource: string, hint?: string): () => void {
  const entry: InFlightWrite = { resource, hint };
  currentWrite = entry;

  return () => {
    // Only clear if we're still the active entry — guards against a later
    // write that registered after us getting wiped by our late `done()`.
    if (currentWrite === entry) {
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
      // TODO: wire up the idempotency key once #91 lands so this hint can
      // include it directly. For now we just emit `(cancelled)` plus a
      // resource-aware show hint.
      const showCmd = `pax8 ${write.resource} show ...`;
      const extra = write.hint ? ` ${write.hint}` : "";
      const msg = `(cancelled) Write was in flight. Run ${showCmd} to confirm state.${extra}\n`;
      try {
        process.stderr.write(chalk.dim(msg));
      } catch {
        // If we can't even write to stderr there's nothing more we can do.
      }
    }

    process.exit(130);
  });
}
