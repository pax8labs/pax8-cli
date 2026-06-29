// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Persistent on-disk cache for the OAuth access token (#233).
 *
 * Every `pax8 <command>` invocation previously rebuilt a fresh `TokenManager`
 * and hit `POST /v1/token` on its first API call — ~100-300 ms of pure auth
 * latency per command, plus one of the 1000 req/min budget burned on auth.
 * Pax8's own auth docs say: *"You should not need to request a new access
 * token before every request."* This module persists the access token to
 * disk (mirroring the `aws-cli` / `gcloud` / `gh` / `stripe-cli` pattern) so
 * subsequent invocations of the CLI can reuse it until it's near expiry.
 *
 * Storage shape:
 *
 *   <configDir>/.token-cache.json   (mode 0o600, O_NOFOLLOW symlink-safe)
 *
 *   {
 *     "accessToken": "...",
 *     "expiresAt":   1715000000000,     // ms-since-epoch
 *     "clientIdHash": "<sha256 hex>",   // hashed, not raw — auto-invalidates
 *                                       // when `auth login` rotates clientId
 *     "apiBaseHash":  "<sha256 hex>"    // hashed too — keeps prod/staging
 *                                       // caches strictly separated
 *   }
 *
 * Hashing instead of storing the raw `clientId` / `apiBase` means a `pax8
 * auth login` with new credentials, or a `PAX8_API_BASE` toggle between
 * prod and staging, automatically invalidates the cache without leaking
 * the previous identity on disk. The hashes are compared byte-for-byte; a
 * mismatch on either dimension is treated as "stale cache, refetch."
 *
 * No file locking. Concurrent invocations may both hit `/token`; last
 * write wins on functionally-identical tokens.
 *
 * Out of scope here (deferred to v1.x): OS-keychain integration. The
 * token-cache file uses the same 0o600 + O_NOFOLLOW protections as
 * `credentials.json` — for a low-value (short-lived, fetchable-from-creds)
 * token that's a reasonable place to start.
 */

import * as fs from "node:fs";
import { createHash } from "node:crypto";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeWriteFileSync } from "../security/safe-write.js";
import { getConfigDir } from "../config/loader.js";

const execFileAsync = promisify(execFile);

const TOKEN_CACHE_FILENAME = ".token-cache.json";
const isWindows = process.platform === "win32";

/**
 * On-disk shape of the token cache. All fields required; a partial file is
 * treated as corrupt and ignored.
 */
export interface TokenCacheFile {
  accessToken: string;
  /** Absolute expiry timestamp in ms since Unix epoch. */
  expiresAt: number;
  /**
   * Original token lifetime in ms (i.e. `expires_in * 1000` at mint time).
   * Persisted so the refresh-skew buffer can be computed as `min(60s, 10% of
   * ttl)` without re-deriving it from `expiresAt` + obtained-at — see
   * `TokenManager`. Pax8 production returns `expires_in=86400` (so this is
   * 86_400_000); the field is part of the on-disk shape so the buffer math
   * stays stable across CLI invocations.
   */
  ttlMs: number;
  /** SHA-256 hex of the clientId the token was minted for. */
  clientIdHash: string;
  /** SHA-256 hex of the API base URL the token was minted against. */
  apiBaseHash: string;
}

export interface TokenCacheLookupKey {
  clientId: string;
  apiBaseUrl: string;
}

export interface PermissionCheckResult {
  /** True iff permissions are tight enough to keep the token confidential. */
  secure: boolean;
  /** Short human-readable detail string — surfaced by `pax8 doctor`. */
  detail: string;
}

function tokenCacheFile(): string {
  return path.join(getConfigDir(), TOKEN_CACHE_FILENAME);
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Normalize an API base URL before hashing. Strips trailing slashes so a
 * `PAX8_API_BASE=https://api.pax8.com/v1` and `…/v1/` resolve to the same
 * cache partition. Mirrors the trailing-slash strip applied by `Pax8Client`
 * and `getTokenUrl` so the hash key matches whatever the caller passes.
 *
 * Implementation: char-by-char loop instead of `replace(/\/+$/, "")`.
 * The regex form is anchored and linear in practice, but CodeQL's static
 * analysis flags the greedy `+` quantifier as polynomial-regex on
 * uncontrolled input (js/polynomial-redos). The loop avoids the false
 * positive without changing semantics — same input → same output.
 */
function normalizeApiBase(raw: string): string {
  let end = raw.length;
  while (end > 0 && raw.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  return raw.slice(0, end);
}

/**
 * Compute the (clientIdHash, apiBaseHash) tuple for a lookup. Exported so
 * callers (TokenManager) can attach the same values to the in-memory cache
 * without recomputing.
 */
export function computeCacheIdentity(key: TokenCacheLookupKey): {
  clientIdHash: string;
  apiBaseHash: string;
} {
  // Reject a degenerate empty clientId. SHA-256 of the empty string is a
  // valid hex digest that would silently match any other empty-clientId
  // session — accidentally sharing a cache key across two callers that
  // both forgot to plumb credentials. Better to fail loud here than
  // surface a confusing cross-session token reuse later.
  if (!key.clientId) {
    throw new Error("computeCacheIdentity: clientId must be a non-empty string");
  }
  return {
    clientIdHash: sha256Hex(key.clientId),
    apiBaseHash: sha256Hex(normalizeApiBase(key.apiBaseUrl)),
  };
}

/**
 * Persistent on-disk store for the OAuth access token.
 *
 * Stateless — every method re-resolves the config dir (honors
 * `PAX8_CONFIG_DIR` set/unset between calls) and opens the file fresh.
 */
export class TokenCacheStore {
  /** Resolved path to the on-disk cache file. */
  static get cacheFilePath(): string {
    return tokenCacheFile();
  }

  /**
   * Read and validate the on-disk cache. Returns `null` for any failure mode
   * — file missing, malformed JSON, missing fields, identity mismatch, or
   * non-fatal I/O errors. The caller treats `null` as "fetch a fresh token."
   *
   * Identity matching: a cached entry is only returned when BOTH `clientIdHash`
   * and `apiBaseHash` match the requested key. A mismatch on either dimension
   * (rotated credentials, prod↔staging switch) is treated as a stale cache.
   */
  load(key: TokenCacheLookupKey): TokenCacheFile | null {
    let raw: string;
    try {
      raw = fs.readFileSync(tokenCacheFile(), "utf-8");
    } catch {
      // ENOENT is the common case (first run); EACCES / EISDIR / etc. are
      // all "treat as no cache" too — failing softly here is the right
      // call because the caller will refetch and overwrite.
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!isTokenCacheFile(parsed)) return null;
  // Defensive: a corrupt file with `ttlMs <= 0` would short-circuit the
  // refresh-buffer math; refuse it before returning to the caller.
  if (parsed.ttlMs <= 0) return null;

    const expected = computeCacheIdentity(key);
    if (
      parsed.clientIdHash !== expected.clientIdHash ||
      parsed.apiBaseHash !== expected.apiBaseHash
    ) {
      // Identity mismatch (credentials rotated or API base flipped). Caller
      // will overwrite on the next save().
      return null;
    }

    return parsed;
  }

  /**
   * Persist `entry` to disk with mode 0o600 and O_NOFOLLOW symlink protection
   * (POSIX) / icacls hardening (Windows). The config dir is created if missing.
   *
   * Best-effort: write failures are swallowed. Rationale: the in-memory token
   * is still valid for the current process, and a disk error (full disk,
   * read-only fs, etc.) shouldn't fail the user's command. The next
   * invocation will re-fetch a token and try writing again.
   */
  async save(entry: TokenCacheFile): Promise<void> {
    const file = tokenCacheFile();
    const dir = path.dirname(file);
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Permissions on the directory itself are owned by CredentialStore /
      // safeWriteFileSync — we don't re-chmod here to avoid clobbering a
      // previously-tightened parent.
      safeWriteFileSync(file, JSON.stringify(entry));
      if (isWindows) {
        await this.secureFileWindows(file);
      }
    } catch {
      // Best-effort. The in-memory token still works for this process.
    }
  }

  /**
   * Remove the on-disk cache. Used on `auth logout`, on 401 recovery, and
   * by tests. Silent on ENOENT; propagates other errors so the caller can
   * decide (e.g. logout surfaces a permission failure to the user).
   */
  clear(): void {
    try {
      fs.unlinkSync(tokenCacheFile());
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw err;
    }
  }

  /**
   * Inspect the on-disk cache's permissions for `pax8 doctor`. Mirrors
   * `CredentialStore.checkPermissions` — same shape so the doctor surface
   * can render the result identically.
   */
  async checkPermissions(): Promise<PermissionCheckResult> {
    const file = tokenCacheFile();
    try {
      fs.accessSync(file, fs.constants.F_OK);
    } catch {
      return {
        secure: true,
        detail: "No token cache file (not yet authenticated)",
      };
    }
    if (isWindows) {
      return this.checkPermissionsWindows(file);
    }
    return this.checkPermissionsUnix(file);
  }

  private checkPermissionsUnix(file: string): PermissionCheckResult {
    try {
      const stat = fs.statSync(file);
      const perms = stat.mode & 0o777;
      if (perms === 0o600) {
        return { secure: true, detail: "Permissions 600 (owner read/write only)" };
      }
      const groupOther = perms & 0o077;
      if (groupOther !== 0) {
        return {
          secure: false,
          detail: `Permissions ${perms.toString(8)} — group/other have access. Run: chmod 600 ${file}`,
        };
      }
      return { secure: true, detail: `Permissions ${perms.toString(8)} (owner-only access)` };
    } catch (err) {
      return {
        secure: false,
        detail: `Could not stat token cache file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async checkPermissionsWindows(file: string): Promise<PermissionCheckResult> {
    try {
      const { stdout } = await execFileAsync("icacls", [file]);
      const homeDir = os.homedir();
      const inUserDir = file.toLowerCase().startsWith(homeDir.toLowerCase());
      if (!inUserDir) {
        return { secure: false, detail: "Token cache file is outside user home directory" };
      }
      const insecurePatterns = ["BUILTIN\\Users", "Everyone", "Authenticated Users"];
      const hasInsecureAcl = insecurePatterns.some(
        (pattern) => stdout.includes(pattern) && !stdout.includes(`${pattern}:(DENY)`),
      );
      if (hasInsecureAcl) {
        return {
          secure: false,
          detail: `File may be readable by other users. Run: icacls "${file}" /inheritance:r /grant:r "%USERNAME%:F"`,
        };
      }
      return { secure: true, detail: "File ACLs restrict access (Windows)" };
    } catch {
      const homeDir = os.homedir();
      const inUserDir = file.toLowerCase().startsWith(homeDir.toLowerCase());
      if (inUserDir) {
        return { secure: true, detail: "In user home directory (could not verify ACLs)" };
      }
      return {
        secure: false,
        detail: "Token cache file is outside user home directory and ACLs could not be verified",
      };
    }
  }

  private async secureFileWindows(file: string): Promise<void> {
    try {
      const username = os.userInfo().username;
      await execFileAsync("icacls", [file, "/inheritance:r", "/grant:r", `${username}:(F)`]);
    } catch {
      // Best-effort. doctor will surface the warning later.
    }
  }
}

/**
 * Type guard for the on-disk cache shape. Treats any missing or wrong-typed
 * field as "not a cache file" — the caller falls back to a fresh fetch.
 */
function isTokenCacheFile(value: unknown): value is TokenCacheFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accessToken === "string" &&
    v.accessToken.length > 0 &&
    typeof v.expiresAt === "number" &&
    Number.isFinite(v.expiresAt) &&
    typeof v.ttlMs === "number" &&
    Number.isFinite(v.ttlMs) &&
    typeof v.clientIdHash === "string" &&
    v.clientIdHash.length > 0 &&
    typeof v.apiBaseHash === "string" &&
    v.apiBaseHash.length > 0
  );
}
