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

/**
 * Redact a single string value. Order matters: longer/more-specific patterns
 * (JWT, Bearer, paths) run before shorter ones (UUID, hex tokens) so a JWT
 * isn't partially eaten by the hex-token rule.
 */
export function redactString(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;

  let out = input;

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

function redactStringArray(arr: string[] | undefined): string[] | undefined {
  if (!arr) return arr;
  return arr.map(redactString);
}

/**
 * Redact every string-typed field of an envelope. Numeric / structural fields
 * pass through untouched.
 */
export function redactEnvelope(env: BugReportEnvelope): BugReportEnvelope {
  const out: BugReportEnvelope = { ...env };
  out.message = redactString(env.message ?? "");
  if (env.code !== undefined) out.code = env.code; // codes are a closed registry — safe.
  if (env.causes !== undefined) out.causes = redactStringArray(env.causes);
  if (env.recoverySteps !== undefined) {
    out.recoverySteps = redactStringArray(env.recoverySteps);
  }
  if (env.docsUrl !== undefined) out.docsUrl = redactString(env.docsUrl);
  if (env.command !== undefined) out.command = redactString(env.command);
  // Flags are flag *names* only by construction; redact defensively in case
  // a future code path puts a value here.
  if (env.flags !== undefined) out.flags = redactStringArray(env.flags);
  // Versions and OS are non-PII metadata; pass through.
  if (env.cli_version !== undefined) out.cli_version = env.cli_version;
  if (env.node_version !== undefined) out.node_version = env.node_version;
  if (env.os !== undefined) out.os = env.os;
  if (env.timestamp !== undefined) out.timestamp = env.timestamp;
  return out;
}
