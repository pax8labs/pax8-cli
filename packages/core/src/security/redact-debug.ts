// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Redactor for debug-mode logging of upstream API response bodies (#263).
 *
 * Before this lived here, `Pax8Client.request()` printed full error response
 * bodies to stderr whenever `--verbose` / `PAX8_DEBUG=1` was set. If the
 * upstream API ever echoed back a bearer token, JWT, or client_secret in
 * its error envelope (some APIs do, especially around 401 paths), that
 * value would land verbatim in the user's terminal — and into any CI log
 * scrape that captured stderr.
 *
 * This is a defense-in-depth scrub. The full report-bug redactor in
 * `@pax8/cli` covers more (UUIDs, emails, home paths) but is also more
 * expensive and lives in the wrong package — core can't import from cli.
 * For the debug-log path we keep the rules narrow and focused on the
 * actually-sensitive shapes:
 *
 *   - `Bearer <token>`              → `Bearer <REDACTED:TOKEN>`
 *   - JWTs (eyJ... three segments)  → `<REDACTED:JWT>`
 *   - `client_secret(...)`          → value replaced with `<REDACTED:TOKEN>`
 *   - long opaque hex/base64 blobs  → `<REDACTED:TOKEN>`
 *
 * Bodies are also truncated to 500 chars so a multi-megabyte HTML error
 * page doesn't drown the user's terminal — debug logs are meant to be
 * quick orientation, not forensic dumps.
 *
 * `PAX8_DEBUG_RAW=1` opts back into raw, unredacted bodies. This is for
 * the rare case where the redaction itself is making a debug session
 * harder (e.g. a token-shaped value that happens to be a legit ID we need
 * to see). It's deliberately a different flag from `PAX8_DEBUG` so users
 * can't accidentally enable raw logging via `--verbose`.
 */

const TRUNCATION_LIMIT = 500;

// JWTs: three dot-separated base64url segments starting with `eyJ`.
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

// `Bearer <token>` — replace the whole pair so the token can't slip past as
// a bare opaque string later.
const BEARER_RE = /Bearer\s+[A-Za-z0-9._\-+/=]+/g;

// `client_secret(...) : "value"` and `client_secret = value`. Captures the
// JSON-style and the YAML-style; the replacement preserves the key+separator
// so the redacted output is still parseable as the same shape.
const SECRET_KEY_RE =
  /(["']?(?:client_secret|access_token|refresh_token|api_key|password)["']?\s*[:=]\s*["']?)([^"'\s,}]+)/gi;

// Long opaque hex / base64-url blobs (>=32 chars). 32 is a deliberate
// floor — a 16-char hex blob can be a legit short ID; a 32+ char one is
// almost always a token / secret / hash. The character class deliberately
// includes lowercase-only runs (L-4): nanoid-style and slugged API keys
// are entirely lowercase, and a mixed-case requirement would let them slip
// through. Word-boundary anchors (`\b`) keep this from chopping inside
// longer alphanumeric strings.
const OPAQUE_TOKEN_RE = /\b[A-Za-z0-9_\-+/=]{32,}\b/g;

/**
 * Run a JSON-stringified error body through the debug redactor.
 *
 * Honors `PAX8_DEBUG_RAW=1` as the opt-out (no redaction, no truncation).
 * Everything else gets the redact pass plus a 500-char truncation tail.
 *
 * Order of replacements matters: we do JWT before `Bearer` (a JWT after
 * the `Bearer` keyword is the most common case, but a JWT can also appear
 * standalone in `access_token` fields, so we run JWT first to avoid the
 * Bearer rule eating only the prefix and leaving the JWT body exposed).
 * `SECRET_KEY_RE` runs before the generic opaque-token rule so the key
 * name is preserved in the output.
 */
export function redactDebugBody(input: string): string {
  if (process.env.PAX8_DEBUG_RAW === "1") {
    return input;
  }

  let out = input.replace(JWT_RE, "<REDACTED:JWT>");
  out = out.replace(BEARER_RE, "Bearer <REDACTED:TOKEN>");
  out = out.replace(SECRET_KEY_RE, (_m, prefix) => `${prefix}<REDACTED:TOKEN>`);
  out = out.replace(OPAQUE_TOKEN_RE, "<REDACTED:TOKEN>");

  if (out.length > TRUNCATION_LIMIT) {
    out = out.slice(0, TRUNCATION_LIMIT) + `... [truncated ${out.length - TRUNCATION_LIMIT} chars]`;
  }

  return out;
}
