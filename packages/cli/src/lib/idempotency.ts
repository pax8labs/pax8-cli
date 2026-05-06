// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

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
  return process.env.PAX8_IDEMPOTENCY_DIR
    ?? path.join(homedir(), ".pax8", "idempotency");
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
  await fs.writeFile(tmp, JSON.stringify(entry), { encoding: "utf-8", mode: 0o600 });
  await fs.rename(tmp, fp);
}
