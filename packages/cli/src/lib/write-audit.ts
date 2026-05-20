// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "@pax8/core";

/**
 * Local accountability log for write commands.
 *
 * Closes the "no local audit trail" half of finding H-5 from the security
 * review. Telemetry is opt-in (the README's privacy section commits to
 * never sending company/subscription data), so an operator running an
 * agent-driven CLI session with telemetry off had no after-the-fact way
 * to ask "what did this agent actually try to do?" The on-disk envelope
 * (`~/.pax8/last-error.json`) only captures the most recent failure.
 *
 * This log fires on every write attempt regardless of telemetry opt-in.
 * One JSON Lines entry per call. Mode 0600 at file creation; subsequent
 * appends preserve that mode.
 *
 * Scope:
 *   - "completed"  → markWriteInFlight()'s `done()` callback ran. The
 *     write API call returned. Success / failure isn't distinguished
 *     here; combine with telemetry / shell exit code if you need that.
 *   - "cancelled" → the SIGINT handler interrupted the write before
 *     `done()` could fire. The agent retry path can use this signal to
 *     decide whether to re-attempt with the same idempotency key.
 *
 * Best-effort: any I/O failure (full disk, read-only fs, sandboxed env)
 * is swallowed. The audit log must never break a write that otherwise
 * succeeded.
 *
 * Platform note: the `O_NOFOLLOW` symlink protection and `0o600` mode
 * assertion are POSIX guarantees. Windows silently ignores both flags
 * when opening a file. On Windows the log's confidentiality and
 * symlink-resistance fall back to whatever ACL the parent
 * `~/.pax8/` directory has — the convention being user-only access
 * established at `pax8 auth login` time. Production-grade Windows
 * hardening would use `CreateFileW` with `FILE_FLAG_OPEN_REPARSE_POINT`
 * and explicit ACL set; that's a separate follow-up.
 */

const FILENAME = "write-audit.log";

export interface WriteAuditEntry {
  /** ISO timestamp at the moment the write resolved or was cancelled. */
  timestamp: string;
  /**
   * Best-effort reconstruction of the subcommand path from argv,
   * positional-arg values stripped (e.g. `"orders create"`,
   * `"subscriptions cancel"`). Never contains user-supplied values.
   */
  command: string;
  /** Domain bucket the write targeted: `"orders"`, `"subscriptions"`, … */
  resource: string;
  /** `"completed"` when done() fired; `"cancelled"` when SIGINT interrupted. */
  outcome: "completed" | "cancelled";
  /** The caller's --idempotency-key value if any. UUID-shape, no PII. */
  idempotencyKey?: string;
}

/**
 * Subcommand path extraction. Mirrors errors.ts's `extractCommandAndFlags`
 * but inlined here — write-audit.ts has only one consumer pattern and
 * shouldn't depend on the error-handling module.
 */
function extractCommand(): string {
  const args = process.argv.slice(2);
  const parts: string[] = [];
  for (const a of args) {
    if (a.startsWith("-")) break;
    if (parts.length >= 2) break;
    if (!/^[a-z][\w-]*$/i.test(a)) break;
    parts.push(a);
  }
  return parts.join(" ") || "unknown";
}

export function recordWriteAudit(entry: Omit<WriteAuditEntry, "timestamp" | "command"> & {
  timestamp?: string;
  command?: string;
}): void {
  try {
    const dir = getConfigDir();
    fs.mkdirSync(dir, { recursive: true });
    const filepath = join(dir, FILENAME);
    const line = JSON.stringify({
      timestamp: entry.timestamp ?? new Date().toISOString(),
      command: entry.command ?? extractCommand(),
      resource: entry.resource,
      outcome: entry.outcome,
      ...(entry.idempotencyKey !== undefined ? { idempotencyKey: entry.idempotencyKey } : {}),
    }) + "\n";

    // O_NOFOLLOW refuses to follow a pre-placed symlink at the
    // destination — an attacker who can write `~/.pax8/write-audit.log`
    // as a symlink to (say) `~/.ssh/authorized_keys` can't use this
    // append path to clobber the target. The 0o600 mode is applied at
    // file creation only; subsequent appends keep whatever mode the
    // file already has.
    const fd = fs.openSync(
      filepath,
      fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fs.writeSync(fd, line);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Best-effort: never let an audit-log failure interfere with the
    // user-facing write outcome.
  }
}
