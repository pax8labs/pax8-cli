// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { getConfigDir, safeWriteFileSync, validateConfigDir } from "@pax8/core";
import { CliError } from "./errors.js";
import { debugLog } from "./debug.js";

/**
 * Idempotency cache for write commands.
 *
 * Storage: one JSON file per entry under `~/.pax8/idempotency/`.
 * Filename is `<sha1(command + ":" + key)>.json`. One-file-per-entry was chosen
 * over a JSON-lines file because:
 *   1. Concurrent writes from different commands don't need locking.
 *   2. GC is a simple stat + unlink loop — no rewrite of an entire file.
 *   3. Atomic writes via tmp+rename are trivial per file.
 *
 * TTL: 24 hours. GC runs on every read and write.
 *
 * The directory can be overridden with `PAX8_IDEMPOTENCY_DIR` (used in tests).
 */

export interface IdempotencyEntry {
  key: string;
  command: string;
  argsHash: string;       // sha256 of normalized args
  output: string;         // captured stdout (or response body)
  exitCode: number;
  createdAt: string;      // ISO8601
}

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function dirPath(): string {
  // #458: route through getConfigDir() so PAX8_CONFIG_DIR is honored.
  // PAX8_IDEMPOTENCY_DIR retains precedence as the explicit per-feature
  // escape hatch used in tests.
  //
  // #M-5: PAX8_IDEMPOTENCY_DIR also goes through validateConfigDir() so a
  // sandboxed/CI environment that controls this var can't redirect the
  // cache to an arbitrary location (e.g. `/etc/...`). The same
  // PAX8_ALLOW_NON_HOME_CONFIG=1 escape hatch applies — vitest.config.ts
  // already sets it for the test workers, so existing tests continue to
  // use tmpdir-based isolation unchanged.
  const override = process.env.PAX8_IDEMPOTENCY_DIR;
  if (override && override.length > 0) {
    return validateConfigDir(override);
  }
  return path.join(getConfigDir(), "idempotency");
}

function entryFilePath(command: string, key: string): string {
  const hash = createHash("sha1").update(`${command}:${key}`).digest("hex");
  return path.join(dirPath(), `${hash}.json`);
}

/**
 * Validate an idempotency key.
 *
 * Accepts:
 *   - UUID v4 (preferred — lowercase hex with hyphens)
 *   - Other "reasonable identifiers": 8–128 chars of letters, digits,
 *     `-`, `_`, `.` (so agents that mint shorter ULIDs / nanoids work).
 *
 * Rejects empty strings, whitespace, and anything outside the charset.
 */
export function isValidKey(key: string): boolean {
  if (typeof key !== "string") return false;
  if (key.length < 8 || key.length > 128) return false;
  return /^[A-Za-z0-9._-]+$/.test(key);
}

/**
 * Hash a normalized record of arguments.
 * Keys are sorted for stability; values are stringified.
 */
export function hashArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, normalizeValue(v)]);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

function normalizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = normalizeValue(obj[k]);
        return acc;
      }, {});
  }
  return v;
}

/**
 * Garbage-collect entries older than the TTL. Best-effort — failures are
 * swallowed so cache problems never break the user's command.
 */
export async function gc(now: number = Date.now()): Promise<void> {
  const dir = dirPath();
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return; // dir doesn't exist
  }

  await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => {
        const fp = path.join(dir, f);
        try {
          const raw = await fs.readFile(fp, "utf-8");
          const entry = JSON.parse(raw) as IdempotencyEntry;
          const ts = Date.parse(entry.createdAt);
          if (Number.isNaN(ts) || now - ts > IDEMPOTENCY_TTL_MS) {
            await fs.unlink(fp).catch(() => {});
          }
        } catch {
          // Corrupt file — remove it.
          await fs.unlink(fp).catch(() => {});
        }
      }),
  );
}

export async function loadEntry(
  command: string,
  key: string,
): Promise<IdempotencyEntry | null> {
  await gc();
  try {
    const raw = await fs.readFile(entryFilePath(command, key), "utf-8");
    const entry = JSON.parse(raw) as IdempotencyEntry;
    const ts = Date.parse(entry.createdAt);
    if (Number.isNaN(ts) || Date.now() - ts > IDEMPOTENCY_TTL_MS) {
      // Stale — remove and return null.
      await fs.unlink(entryFilePath(command, key)).catch(() => {});
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export async function saveEntry(entry: IdempotencyEntry): Promise<void> {
  await gc();
  const dir = dirPath();
  await fs.mkdir(dir, { recursive: true });
  const fp = entryFilePath(entry.command, entry.key);
  const tmp = fp + ".tmp";
  // #458: write via safeWriteFileSync so the tmp file is created with
  // mode 0o600 atomically (no chmod race) and an attacker-placed symlink
  // at the tmp path can't redirect the write.
  safeWriteFileSync(tmp, JSON.stringify(entry));
  await fs.rename(tmp, fp);
}

export interface IdempotencyOptions<T = unknown> {
  /** Cache key namespace, e.g. "orders.create". */
  commandName: string;
  /** User-supplied replay key. If undefined the wrapper is a passthrough. */
  idempotencyKey?: string;
  /**
   * Stable hash of the action's effective arguments. Used to detect "same
   * key, different args" reuse and refuse to replay. Callers compute this
   * with `hashArgs()`.
   */
  argsHash: string;
  /**
   * Optional predicate to skip persisting the cache entry on certain
   * "successful" returns — e.g. when the user cancels at a confirmation
   * prompt. Defaults to "always persist on action success".
   */
  shouldPersist?: (result: T) => boolean;
}

/**
 * Wrap a write action with idempotency-key handling.
 *
 * Behavior:
 *   1. If `opts.idempotencyKey` is undefined → invoke `action()` as a
 *      passthrough. No cache lookup, no stdout capture.
 *   2. If a cached entry exists for `(commandName, idempotencyKey)`:
 *        - If `argsHash` matches → write the cached stdout to the user's
 *          terminal and `process.exit(cached.exitCode)`. The action does
 *          NOT re-run.
 *        - If `argsHash` differs → throw a `CliError` (refuse to replay
 *          with different args; could double-write).
 *   3. Otherwise: install a `process.stdout.write` proxy that tees output
 *      both to the real terminal and an in-memory buffer; run `action`;
 *      on success persist the captured buffer + exitCode 0 under the
 *      cache key; restore stdout; return the action's value. On failure,
 *      stdout is restored and the cache is NOT written (the agent retries).
 *
 * The caller is responsible for:
 *   - Validating the key format with `isValidKey()` and throwing a
 *     CliError before calling this wrapper.
 *   - Computing `argsHash` from the action's effective arguments.
 *   - Calling `markWriteInFlight()` around the actual write inside `action`.
 */
export async function withIdempotency<T>(
  opts: IdempotencyOptions<T>,
  action: () => Promise<T>,
): Promise<T> {
  const { commandName, idempotencyKey, argsHash, shouldPersist } = opts;

  // Passthrough: no key supplied.
  if (idempotencyKey === undefined) {
    return action();
  }

  // #M-5: eagerly validate the cache dir env-var so a hostile
  // PAX8_IDEMPOTENCY_DIR (e.g. /etc/...) is rejected by the home-dir
  // guard with a propagating CliError. The downstream loadEntry/saveEntry
  // calls are deliberately fail-open for transient cache problems
  // (read-only fs, full disk) — which would otherwise swallow the
  // security error and silently fall back to running the action. By
  // probing dirPath() here, validateConfigDir() runs in a context that
  // can throw cleanly through to handleCommandError.
  dirPath();

  // Cache hit branch. `loadEntry` itself is wrapped so that a transient
  // read failure leaves us in fail-open mode (we run the action). The
  // replay path below is intentionally *not* inside that try/catch — once
  // we have a cached entry, any further error must propagate so the user
  // sees it (e.g. CliError on argsHash mismatch).
  let cached: IdempotencyEntry | null = null;
  try {
    cached = await loadEntry(commandName, idempotencyKey);
  } catch (err) {
    debugLog("idempotency cache read failed", err);
  }
  if (cached) {
    if (cached.argsHash !== argsHash) {
      throw new CliError(
        "Idempotency key reused with different arguments — refusing to retry.",
        [
          `The key "${idempotencyKey}" was previously used for ${cached.command} with a different argument set.`,
          "Replaying with new arguments would risk a double-write or a misleading 'cached' response.",
        ],
        [
          "Generate a new idempotency key for the new request.",
          `Or wait 24h for the old entry to expire (cached at ${cached.createdAt}).`,
        ],
      );
    }
    process.stderr.write(chalk.dim("  (idempotent replay)\n"));
    if (cached.output) process.stdout.write(cached.output);
    process.exit(cached.exitCode);
  }

  // Cache miss: tee stdout to memory while running the action.
  let captured = "";
  // Preserve a reference to the *original* function so we can restore it
  // exactly (preserves identity for tests / nested wrappers). Use a bound
  // copy for the actual passthrough call inside the proxy.
  const originalStdoutWrite = process.stdout.write;
  const writeBound = originalStdoutWrite.bind(process.stdout);
  // Cast to satisfy the multi-overload signature of process.stdout.write.
  (process.stdout.write as unknown as (chunk: string | Uint8Array) => boolean) = (
    chunk: string | Uint8Array,
  ): boolean => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
    captured += text;
    return writeBound(chunk as string);
  };

  try {
    const value = await action();
    // Persist on success only — and skip when the caller's predicate says
    // we shouldn't (e.g. user cancelled at a confirmation prompt).
    const persist = shouldPersist ? shouldPersist(value) : true;
    if (persist) {
      try {
        await saveEntry({
          key: idempotencyKey,
          command: commandName,
          argsHash,
          output: captured,
          exitCode: 0,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        debugLog("idempotency cache write failed", err);
      }
    }
    return value;
  } finally {
    // Always restore stdout, even on action failure. Restoring the
    // original function (not a bound copy) preserves reference identity.
    process.stdout.write = originalStdoutWrite;
  }
}
