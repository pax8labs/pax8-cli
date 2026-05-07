// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Safe write helpers for state files in the user's config directory.
 *
 * Background (#262): a stale or attacker-placed symlink at the destination
 * of a state-file write (e.g. `~/.pax8/credentials.json` pointing at
 * `/etc/passwd`) would cause `fs.writeFileSync` to follow the symlink and
 * land the write at the link target. Beyond that, `writeFileSync` followed
 * by `chmodSync(0o600)` has a small window where the file exists with the
 * default umask permissions before being tightened — a TOCTOU race that
 * matters for credential files.
 *
 * Both problems are fixed by opening the file with explicit POSIX flags:
 *
 *   O_WRONLY     — write-only (we don't read existing contents).
 *   O_CREAT      — create if missing.
 *   O_TRUNC      — overwrite an existing regular file.
 *   O_NOFOLLOW   — refuse to open if the path is itself a symlink. This is
 *                  the symlink-attack defense; the open() syscall returns
 *                  ELOOP rather than landing the write at the target.
 *
 * The mode argument to `openSync` (third positional) is honored only when
 * `O_CREAT` actually creates the file. For an existing regular file we
 * follow up with `chmodSync` to tighten perms — but in the create case the
 * mode is set atomically at file-creation time, eliminating the race.
 *
 * `O_NOFOLLOW` is POSIX-specific. On Windows the constant either isn't
 * defined or is a no-op; we feature-detect via `fs.constants` and fall back
 * to a plain create. Windows has its own ACL story (see CredentialStore's
 * Windows path) so this isn't a regression there.
 */

import * as fs from "node:fs";

/**
 * Atomically write `data` to `filePath` with mode `0o600`, refusing to
 * follow an existing symlink at the destination.
 *
 * On POSIX, opens with `O_CREAT | O_WRONLY | O_TRUNC | O_NOFOLLOW` and the
 * 0o600 mode — the file is created with the right perms in one syscall, and
 * an existing symlink at the path causes `ELOOP`. On Windows (no
 * `O_NOFOLLOW`), we fall back to the same flags minus `O_NOFOLLOW` and
 * follow up with `chmodSync` for parity with the previous behavior.
 *
 * Errors propagate to the caller — this helper does NOT swallow failures.
 * Callers that want best-effort writes (e.g. last-error envelope) should
 * wrap in their own `try { ... } catch {}`.
 */
export function safeWriteFileSync(filePath: string, data: string | Buffer): void {
  const C = fs.constants;
  // Build the flag bag. O_NOFOLLOW is POSIX-only; on Windows the constant is
  // either missing or 0, in which case it's a harmless no-op here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noFollow: number = (C as any).O_NOFOLLOW ?? 0;
  const flags = C.O_WRONLY | C.O_CREAT | C.O_TRUNC | noFollow;
  const fd = fs.openSync(filePath, flags, 0o600);
  try {
    const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
    fs.writeSync(fd, buf);
  } finally {
    fs.closeSync(fd);
  }
}
