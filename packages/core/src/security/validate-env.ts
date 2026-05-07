// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Security guards for trust-sensitive environment variables.
 *
 * Both `PAX8_API_BASE` and `PAX8_CONFIG_DIR` are user-controllable inputs that
 * flow into trust-sensitive operations (bearer-token-bearing HTTP requests,
 * credential file writes). Without validation:
 *
 *   - `PAX8_API_BASE=http://attacker.example.com` would happily POST our OAuth
 *     client credentials to a plaintext attacker-controlled host (#234).
 *   - `PAX8_CONFIG_DIR=/tmp/whatever` would let credentials.json land outside
 *     the user's home directory, and a pre-placed symlink at the destination
 *     could redirect the write to an arbitrary path (#262).
 *
 * The guards live in core so every caller — `Pax8Client`, `TokenManager`, the
 * config loader, the credential store, the last-error envelope writer —
 * inherits the same checks for free, regardless of which package they live in.
 *
 * Both helpers read `process.env` lazily on every call. Validation is cheap
 * and the env var can change between calls in test contexts, so we don't
 * cache the result.
 */

import * as os from "node:os";
import * as path from "node:path";
import {
  ERROR_INVALID_INPUT,
  type Pax8ErrorCode,
} from "../errors/codes.js";

/**
 * Error thrown when a trust-sensitive env var fails validation. Carries the
 * same `code` / `causes` / `recoverySteps` / `docsUrl` shape as the CLI's
 * `CliError` so the top-level error renderer can display it uniformly without
 * a special case. The CLI's error handler recognizes this class structurally
 * (see `handleCommandError`) and renders it the same as a `CliError`.
 *
 * Lives in core (rather than cli) because the validation it surfaces is
 * triggered from core call sites — the API client constructor, the token
 * manager, the config loader. core cannot import from cli, but cli can import
 * from core, so the class hierarchy points one way.
 */
export class Pax8SecurityError extends Error {
  public readonly code: Pax8ErrorCode;
  public readonly causes?: string[];
  public readonly recoverySteps?: string[];
  public readonly docsUrl?: string;

  constructor(
    message: string,
    options: {
      causes?: string[];
      recoverySteps?: string[];
      docsUrl?: string;
      code?: Pax8ErrorCode;
    } = {},
  ) {
    super(message);
    this.name = "Pax8SecurityError";
    this.code = options.code ?? ERROR_INVALID_INPUT;
    this.causes = options.causes;
    this.recoverySteps = options.recoverySteps;
    this.docsUrl = options.docsUrl;
  }
}

// ─── PAX8_API_BASE validation ───────────────────────────────────────────────

/**
 * Hosts that are allowed over plain http:// without any opt-out. These are
 * loopback addresses where confidentiality is a non-issue (the traffic never
 * leaves the developer's machine).
 *
 * `*.localhost` is included because RFC 6761 reserves the entire `.localhost`
 * TLD for loopback, and tools like Caddy / Traefik commonly use names like
 * `api.localhost` or `pax8.localhost` for local development.
 */
function isLoopbackHost(host: string): boolean {
  // URL.host includes the port; URL.hostname doesn't. Use hostname here.
  const h = host.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") {
    return true;
  }
  if (h.endsWith(".localhost")) return true;
  return false;
}

const RED_BOLD = "\x1b[1m\x1b[31m";
const RESET = "\x1b[0m";

/**
 * Validate a value destined for use as the API base URL.
 *
 * Accepted:
 *   - `https://...`                                → as-is.
 *   - `http://localhost`, `http://127.0.0.1`,
 *     `http://[::1]`, `http://*.localhost`         → as-is (loopback dev).
 *   - `http://other-host` with `PAX8_ALLOW_INSECURE_BASE=1`
 *                                                  → as-is, but emits a loud
 *                                                    red-bold warning to
 *                                                    stderr on every call.
 *
 * Rejected (throws `Pax8SecurityError`):
 *   - `http://other-host` without the env opt-out  → would leak the bearer
 *                                                    token over plaintext.
 *   - garbage that doesn't parse as a URL          → no way to decide safely.
 *
 * Returns the validated URL string unchanged. The caller can then strip
 * trailing slashes etc; we don't normalize here so that the trailing-slash
 * test in client.test.ts continues to round-trip its input.
 */
export function validateBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Pax8SecurityError(
      `Invalid PAX8_API_BASE: ${raw} is not a valid URL.`,
      {
        code: ERROR_INVALID_INPUT,
        causes: [
          "PAX8_API_BASE must be an absolute URL like https://api.pax8.com/v1.",
        ],
        recoverySteps: [
          "Set PAX8_API_BASE to a full https:// URL, or unset it to use the production default.",
          "Example: export PAX8_API_BASE=https://api.pax8.com/v1",
        ],
      },
    );
  }

  if (parsed.protocol === "https:") {
    return raw;
  }

  if (parsed.protocol === "http:") {
    if (isLoopbackHost(parsed.hostname)) {
      // Localhost over http is fine — traffic never leaves the machine.
      return raw;
    }
    if (process.env.PAX8_ALLOW_INSECURE_BASE === "1") {
      // Opt-in escape hatch for non-prod testing against an http-only
      // upstream. Loud warning on every call so this is impossible to miss
      // in CI logs or terminal scrollback.
      process.stderr.write(
        `${RED_BOLD}WARNING:${RESET} PAX8_API_BASE is set to a plaintext http:// URL ` +
          `(${raw}). Bearer tokens will be sent in cleartext to this host. ` +
          `This is enabled because PAX8_ALLOW_INSECURE_BASE=1 — unset that ` +
          `variable to restore the default (https-only) behavior.\n`,
      );
      return raw;
    }
    throw new Pax8SecurityError(
      `Refusing to use plaintext http:// URL for PAX8_API_BASE: ${raw}`,
      {
        code: ERROR_INVALID_INPUT,
        causes: [
          "Bearer tokens (PAX8_CLIENT_SECRET, OAuth access tokens) would be sent " +
            "in cleartext to this host, which is unsafe outside of localhost.",
        ],
        recoverySteps: [
          "Use an https:// URL: export PAX8_API_BASE=https://api.pax8.com/v1",
          "Or, for local development, point at a loopback address: " +
            "PAX8_API_BASE=http://localhost:8080",
          "If you must use a non-localhost http:// host (e.g. an internal " +
            "test rig), opt in explicitly: PAX8_ALLOW_INSECURE_BASE=1",
        ],
      },
    );
  }

  throw new Pax8SecurityError(
    `Unsupported protocol for PAX8_API_BASE: ${parsed.protocol}`,
    {
      code: ERROR_INVALID_INPUT,
      causes: [
        `Only http:// and https:// are supported; got "${parsed.protocol}".`,
      ],
      recoverySteps: [
        "Set PAX8_API_BASE to an https:// URL, or unset it to use the production default.",
      ],
    },
  );
}

// ─── PAX8_CONFIG_DIR validation ─────────────────────────────────────────────

/**
 * Validate a value destined for use as the config directory.
 *
 * Accepted:
 *   - resolves under the user's `os.homedir()`            → normal case.
 *   - `=== os.homedir()` (caller wrote `$HOME` directly)  → tolerated.
 *   - resolves outside the home directory, with
 *     `PAX8_ALLOW_NON_HOME_CONFIG=1`                      → opt-in escape.
 *
 * Rejected (throws `Pax8SecurityError`):
 *   - resolves outside the home directory, no opt-out     → write-outside-
 *                                                           sandbox vector.
 *
 * Returns the canonicalized (resolved) path so the caller doesn't have to
 * resolve again. Symlink protection at the file level is layered on top via
 * the `safeWriteFileSync` helper — this validator only checks the directory
 * root.
 */
export function validateConfigDir(raw: string): string {
  const resolved = path.resolve(raw);
  const home = os.homedir();

  // `homedir + sep` to avoid a prefix-match false positive: if home is
  // `/Users/jane` and the override is `/Users/janet/...`, startsWith without
  // the separator would match. The `=== home` branch covers the exact-match
  // case (someone literally passed the home directory as the config dir).
  if (resolved === home) return resolved;
  if (resolved.startsWith(home + path.sep)) return resolved;

  if (process.env.PAX8_ALLOW_NON_HOME_CONFIG === "1") {
    return resolved;
  }

  throw new Pax8SecurityError(
    `Refusing to use config directory outside of $HOME: ${resolved}`,
    {
      code: ERROR_INVALID_INPUT,
      causes: [
        `PAX8_CONFIG_DIR resolves to ${resolved}, which is outside the user's ` +
          `home directory (${home}). The CLI writes credentials and other ` +
          `state files into this directory; allowing writes outside $HOME ` +
          `widens the blast radius if a path is attacker-controlled.`,
      ],
      recoverySteps: [
        "Point PAX8_CONFIG_DIR at a path under your home directory, e.g. " +
          `PAX8_CONFIG_DIR=${path.join(home, ".pax8-test")}`,
        "Or unset PAX8_CONFIG_DIR to use the default ~/.pax8.",
        "If you genuinely need a config dir outside $HOME (e.g. CI, sandbox), " +
          "opt in explicitly: PAX8_ALLOW_NON_HOME_CONFIG=1",
      ],
    },
  );
}
