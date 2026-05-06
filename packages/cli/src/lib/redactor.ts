// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Redactor for the `pax8 report-bug` command. Takes a structured error
 * envelope and returns a sanitized copy with anything that smells like PII,
 * a secret, or a path under `$HOME` replaced with a `<REDACTED:KIND>` marker.
 *
 * Markers (instead of empty strings) are deliberate — they let a reviewer of
 * the resulting GitHub issue see *what* was stripped, which doubles as a
 * sanity check against over-redaction.
 *
 * The README's "Never sent" section is the load-bearing privacy contract this
 * module enforces. When in doubt, redact more aggressively.
 */
export interface BugReportEnvelope {
  code?: string;
  message: string;
  causes?: string[];
  recoverySteps?: string[];
  docsUrl?: string;
  command?: string;
  flags?: string[];
  cli_version?: string;
  node_version?: string;
  os?: string;
  timestamp?: string;
}

// UUIDs (covers Pax8 client_id and most resource IDs).
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Email addresses.
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

// JWTs (eyJ... three dot-separated base64url segments).
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

// Bearer prefix attached to a token-shaped string (any non-whitespace run).
// Replace the whole `Bearer xxx` so the token alone can't slip through later
// when an opaque-token rule has a length floor.
const BEARER_RE = /Bearer\s+[A-Za-z0-9._\-+/=]+/g;

// Character class for opaque-token bodies. `=` is excluded (it's a separator
// like `key=value`); base64 padding `==` at the tail is rare in token output
// and we'd rather under-match than collapse `key=long_word_here`.
const TOKEN_CHARS = "A-Za-z0-9_\\-+/";

// macOS / Linux home paths. The capture preserves the suffix so the tail
// (e.g. `/.pax8/config.yaml`) remains useful for debugging.
const POSIX_HOME_RE = /\/(?:Users|home)\/[^/\s"'`]+(\/[^\s"'`]*)?/g;

// Windows home paths. Both backslash and forward-slash forms appear in
// stringified paths; handle both.
const WIN_HOME_RE = /[Cc]:[\\/]Users[\\/][^\\/\s"'`]+([\\/][^\s"'`]*)?/g;

// Tilde-style home references — only when followed by a path separator so we
// don't match e.g. "~10 minutes".
const TILDE_HOME_RE = /~(\/[^\s"'`]*)/g;

// Long opaque hex strings (>=32 chars) — likely tokens, hashes, or secrets.
// Word boundaries keep it from chopping up sentences. UUIDs would already be
// caught above, but we still match here to cover non-hyphenated hex blobs.
const HEX_TOKEN_RE = /\b[0-9a-fA-F]{32,}\b/g;

// Long base64-ish opaque strings that look like API tokens / client_secrets.
// Pax8 client secrets are roughly 40–60 chars of base64; we use a 32+ floor
// with required mixed character classes to avoid eating English words.
// Excluded: pure-alpha words, pure-digit numbers, hex (covered above).
const OPAQUE_TOKEN_RE = new RegExp(
  `(?<![${TOKEN_CHARS}])` +
    `(?=[${TOKEN_CHARS}]{32,}(?![${TOKEN_CHARS}]))` +
    `(?=[${TOKEN_CHARS}]*[A-Z])` +
    `(?=[${TOKEN_CHARS}]*[a-z])` +
    `(?=[${TOKEN_CHARS}]*[0-9])` +
    `[${TOKEN_CHARS}]{32,}`,
  "g",
);

// Escape regex metacharacters so an arbitrary user-supplied positional arg
// (e.g. `Acme Corp.` or `(Test) Co`) can be safely embedded in a RegExp.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary-ish character class for positional-arg matching. We treat
// alphanumerics and `_` as "word" characters; surrounding chars must NOT be
// in this class for the token to count as a full match. This lets us strip
// `Inc` from `"Real Customer Inc"` (preceded by a space, followed by `"`)
// without also stripping `Inc` out of `"Incident"` (followed by `i`).
const ARG_BOUNDARY = "A-Za-z0-9_";

/**
 * Redact a single string value. Order matters: longer/more-specific patterns
 * (JWT, Bearer, paths) run before shorter ones (UUID, hex tokens) so a JWT
 * isn't partially eaten by the hex-token rule.
 *
 * `argTokens` (optional) are user-supplied positional argv values — e.g.
 * customer / company / product names typed at the command line. When
 * present, exact full-token matches are replaced with `<REDACTED:ARG>`
 * before the generic rules run, so an embedded company name inside an
 * error message gets stripped even if it doesn't match any other pattern.
 * Empty / whitespace-only / very short tokens are skipped — too risky to
 * blanket-replace single letters or `""` across the message.
 */
export function redactString(input: string, argTokens: string[] = []): string {
  if (typeof input !== "string" || input.length === 0) return input;

  let out = input;

  // Positional-arg tokens first: exact-token replacement (boundary-aware so
  // we don't substring-match into other words). Run longest-first so a
  // multi-word value like "Real Customer Inc" doesn't get partially chewed
  // by a shorter overlapping token. Skip tokens shorter than 2 chars — a
  // 1-char positional arg is too noisy to blanket-redact.
  if (argTokens.length > 0) {
    const tokens = argTokens
      .filter((t) => typeof t === "string" && t.trim().length >= 2)
      .sort((a, b) => b.length - a.length);
    for (const tok of tokens) {
      const re = new RegExp(
        `(?<![${ARG_BOUNDARY}])${escapeRegex(tok)}(?![${ARG_BOUNDARY}])`,
        "g",
      );
      out = out.replace(re, "<REDACTED:ARG>");
    }
  }

  // JWTs first (most specific, includes dots).
  out = out.replace(JWT_RE, "<REDACTED:JWT>");
  // Bearer-prefixed tokens.
  out = out.replace(BEARER_RE, "Bearer <REDACTED:TOKEN>");
  // Path-shaped values before UUID/email so a username inside a path is
  // collapsed into the path marker rather than emerging as a bare word.
  out = out.replace(WIN_HOME_RE, (_m, suffix) => `<REDACTED:PATH>${suffix ?? ""}`);
  out = out.replace(POSIX_HOME_RE, (_m, suffix) => `<REDACTED:PATH>${suffix ?? ""}`);
  out = out.replace(TILDE_HOME_RE, (_m, suffix) => `<REDACTED:PATH>${suffix ?? ""}`);
  // Emails before UUIDs (an email's local part can contain dots and digits
  // but isn't UUID-shaped, so order is mostly defensive).
  out = out.replace(EMAIL_RE, "<REDACTED:EMAIL>");
  // UUIDs (covers Pax8 client_id, resource IDs).
  out = out.replace(UUID_RE, "<REDACTED:UUID>");
  // Opaque tokens (mixed-class long base64) — must run before HEX so a hex
  // string with mixed case doesn't prematurely match the hex rule.
  out = out.replace(OPAQUE_TOKEN_RE, "<REDACTED:TOKEN>");
  // Long hex blobs.
  out = out.replace(HEX_TOKEN_RE, "<REDACTED:TOKEN>");

  return out;
}

function redactStringArray(
  arr: string[] | undefined,
  argTokens: string[] = [],
): string[] | undefined {
  if (!arr) return arr;
  return arr.map((s) => redactString(s, argTokens));
}

/**
 * Redact every string-typed field of an envelope. Numeric / structural fields
 * pass through untouched.
 *
 * `argTokens` (optional) are the original positional argv values that the
 * envelope-write site captured. When supplied, an exact-match (full-token,
 * not substring) pass replaces those values with `<REDACTED:ARG>` in every
 * string field — defense in depth against `CliError` sites that interpolate
 * the raw arg value into `message` or `causes` (e.g.
 * `Company not found: "${input}"`). Without this, a normal company name
 * doesn't match any of the existing UUID / email / path / token patterns
 * and would slip through to the report. See #170.
 */
export function redactEnvelope(
  env: BugReportEnvelope,
  argTokens: string[] = [],
): BugReportEnvelope {
  const out: BugReportEnvelope = { ...env };
  out.message = redactString(env.message ?? "", argTokens);
  if (env.code !== undefined) out.code = env.code; // codes are a closed registry — safe.
  if (env.causes !== undefined) out.causes = redactStringArray(env.causes, argTokens);
  if (env.recoverySteps !== undefined) {
    out.recoverySteps = redactStringArray(env.recoverySteps, argTokens);
  }
  if (env.docsUrl !== undefined) out.docsUrl = redactString(env.docsUrl, argTokens);
  // `command` is constructed at envelope-write time as `<subcmd path>
  // <REDACTED:ARG> ...`, so the raw arg values shouldn't be present here —
  // but pass argTokens defensively in case a caller hands us a pre-built
  // command string.
  if (env.command !== undefined) out.command = redactString(env.command, argTokens);
  // Flags are flag *names* only by construction; redact defensively in case
  // a future code path puts a value here.
  if (env.flags !== undefined) out.flags = redactStringArray(env.flags, argTokens);
  // Versions and OS are non-PII metadata; pass through.
  if (env.cli_version !== undefined) out.cli_version = env.cli_version;
  if (env.node_version !== undefined) out.node_version = env.node_version;
  if (env.os !== undefined) out.os = env.os;
  if (env.timestamp !== undefined) out.timestamp = env.timestamp;
  return out;
}
