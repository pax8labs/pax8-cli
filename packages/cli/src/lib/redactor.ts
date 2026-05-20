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
//
// The eslint-plugin-security rule flags this as a potentially-unsafe regex
// because of the nested optional group, but each character class excludes
// the path separator (`/`) and whitespace, so backtracking is bounded by
// the input length — no quadratic catastrophic-backtracking shape.
// eslint-disable-next-line security/detect-unsafe-regex
const POSIX_HOME_RE = /\/(?:Users|home)\/[^/\s"'`]+(\/[^\s"'`]*)?/g;

// Windows home paths. Both backslash and forward-slash forms appear in
// stringified paths; handle both. Same bounded-backtracking shape as
// POSIX_HOME_RE above; the inner character classes exclude the separators.
// eslint-disable-next-line security/detect-unsafe-regex
const WIN_HOME_RE = /[Cc]:[\\/]Users[\\/][^\\/\s"'`]+([\\/][^\s"'`]*)?/g;

// Tilde-style home references — only when followed by a path separator so we
// don't match e.g. "~10 minutes".
const TILDE_HOME_RE = /~(\/[^\s"'`]*)/g;

// Long opaque hex strings (>=32 chars) — likely tokens, hashes, or secrets.
// Word boundaries keep it from chopping up sentences. UUIDs would already be
// caught above, but we still match here to cover non-hyphenated hex blobs.
const HEX_TOKEN_RE = /\b[0-9a-fA-F]{32,}\b/g;

// Long base64-ish opaque strings that look like API tokens / client_secrets.
// Pax8 client secrets are roughly 40–60 chars of base64; we use a 32+ floor.
// L-4 fix: the prior version required mixed-case AND a digit, which let
// pure-lowercase ≥32-char tokens (e.g. nanoid-style API keys, slugged
// secrets) slip through entirely. The relaxation here drops the
// character-class lookaheads: any ≥32-char run of token-character bytes
// bounded by non-token-chars is redacted. The word-boundary anchors (the
// `(?<![TOKEN_CHARS])` lookbehind and the embedded `(?![TOKEN_CHARS])`
// lookahead) prevent matching inside a longer alphanumeric run, and the
// 32-char floor keeps English prose safe — the longest commonly-written
// English word is "antidisestablishmentarianism" at 28 chars, under the
// floor. The handful of >32 char technical compound words that exist
// (e.g. medical terminology) showing up in a bug report is acceptable
// over-redaction for a privacy-first error pipeline; the `<REDACTED:TOKEN>`
// marker tells a human reviewer something was scrubbed.
const OPAQUE_TOKEN_RE = new RegExp(
  `(?<![${TOKEN_CHARS}])` +
    `[${TOKEN_CHARS}]{32,}` +
    `(?![${TOKEN_CHARS}])`,
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

// #473: harvest "quoted-string" substrings from message / causes /
// recoverySteps and treat them as additional argTokens. This closes the
// upstream-resolved-name leak: when a CliError site interpolates an
// API-resolved company / contact / product name into its error text via the
// canonical `Foo not found: "${name}"` pattern, the name is *not* in argv
// (so `extractCommandAndFlags` doesn't pick it up) but it IS inside double
// or single quotes in the cause text. Treating those quoted strings as
// argTokens fan-out lets the existing positional-arg redaction strip them
// uniformly.
//
// Caveats:
//   - We harvest from the same strings the redactor is about to scrub.
//   - We respect the existing 2-char floor; very short quoted strings
//     (`""`, `"x"`) are skipped to avoid runaway over-redaction.
//   - The character class is `[^\n]` (not `[^"\n]` / `[^'\n]`) so the greedy
//     quantifier extends from the *first* quote to the *last* matching quote
//     on a logical line. This is deliberate — a partner name like
//     `Acme" $(echo PWNED) "` produces a cause string with multiple `"`s
//     inside the same logical span (`"Acme" $(echo PWNED) ""`), and a
//     character-class-restricted regex would only harvest the inner
//     `"Acme"` chunk, leaving `$(echo PWNED)` naked in the report. By
//     allowing inner quotes in the captured run, the whole hostile span
//     becomes one argToken and the existing redactString pass scrubs it
//     atomically. Trade-off: a legitimate cause with two unrelated quoted
//     terms on the same line (e.g. `Matched "Foo" against "Bar"`) collapses
//     into a single `<REDACTED:ARG>` covering everything between the
//     outermost quotes — acceptable over-redaction for a bug-report
//     pipeline whose default posture is "scrub more than less."
//   - This is best-effort. CliError sites that interpolate a name *without*
//     quoting it (e.g. `"Subscription Acme Corp — not found"`) still slip
//     through this specific extractor. Such sites should be migrated to
//     quote their interpolated values; until then they need an explicit
//     argToken pass at the catch site.
const QUOTED_RE = /"([^\n]{2,})"|'([^\n]{2,})'/g;

function extractQuotedTokens(input: string | undefined): string[] {
  if (!input) return [];
  const found: string[] = [];
  for (const m of input.matchAll(QUOTED_RE)) {
    const tok = m[1] ?? m[2];
    if (tok && tok.trim().length >= 2) found.push(tok);
  }
  return found;
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
 *
 * In addition to the caller-supplied `argTokens`, we now auto-augment the
 * token list with any quoted substrings found in `message` / `causes` /
 * `recoverySteps`. This catches upstream-resolved names (company /
 * contact / product names returned by the Pax8 API and threaded into a
 * `CliError.causes[]` entry via the canonical `… "${name}"` pattern) that
 * are not in argv. See #473.
 */
/**
 * L-5 helper: recursively walk a value (object / array / primitive) and apply
 * `redactString(_, allTokens)` to every string encountered. Depth-capped so a
 * pathological structure can't blow the stack or pin a CPU. Non-string
 * primitives (numbers, booleans, null) pass through unchanged.
 *
 * The envelope-level redactor names a closed set of fields (`message`,
 * `causes[]`, `recoverySteps[]`, `docsUrl`, `command`, `flags[]`) and scrubs
 * each individually. If a future code path attaches a nested object to the
 * envelope (e.g. `details = { partnerEmail: "..." }`), those nested strings
 * would otherwise sail through the named-field pass untouched. This deep
 * walker is the defense-in-depth backstop: after the named-field pass runs,
 * we re-walk the full envelope and scrub any string we find. Idempotent —
 * already-redacted markers like `<REDACTED:UUID>` re-run through the rules
 * with no further change.
 */
const DEEP_WALK_MAX_DEPTH = 8;

function redactDeep(value: unknown, allTokens: string[], depth = 0): unknown {
  if (depth > DEEP_WALK_MAX_DEPTH) return value;
  if (typeof value === "string") return redactString(value, allTokens);
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, allTokens, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v, allTokens, depth + 1);
    }
    return out;
  }
  return value;
}

export function redactEnvelope(
  env: BugReportEnvelope,
  argTokens: string[] = [],
): BugReportEnvelope {
  // #473: combine caller-supplied argTokens with quoted-string tokens
  // harvested from the envelope's own message / causes / recoverySteps.
  // The harvested tokens cover the upstream-resolved-name path that the
  // argv-derived tokens cannot see.
  const harvested: string[] = [
    ...extractQuotedTokens(env.message),
    ...(env.causes ?? []).flatMap(extractQuotedTokens),
    ...(env.recoverySteps ?? []).flatMap(extractQuotedTokens),
  ];
  // Dedupe — same string showing up in argv and inside quotes in the
  // message is the common case (the user typed "Acme Corp", we interpolated
  // it back into the error). One pass is enough.
  const allTokens = [...new Set([...argTokens, ...harvested])];

  const out: BugReportEnvelope = { ...env };
  out.message = redactString(env.message ?? "", allTokens);
  if (env.code !== undefined) out.code = env.code; // codes are a closed registry — safe.
  if (env.causes !== undefined) out.causes = redactStringArray(env.causes, allTokens);
  if (env.recoverySteps !== undefined) {
    out.recoverySteps = redactStringArray(env.recoverySteps, allTokens);
  }
  if (env.docsUrl !== undefined) out.docsUrl = redactString(env.docsUrl, allTokens);
  // `command` is constructed at envelope-write time as `<subcmd path>
  // <REDACTED:ARG> ...`, so the raw arg values shouldn't be present here —
  // but pass argTokens defensively in case a caller hands us a pre-built
  // command string.
  if (env.command !== undefined) out.command = redactString(env.command, allTokens);
  // Flags are flag *names* only by construction; redact defensively in case
  // a future code path puts a value here.
  if (env.flags !== undefined) out.flags = redactStringArray(env.flags, allTokens);
  // Versions and OS are non-PII metadata; pass through.
  if (env.cli_version !== undefined) out.cli_version = env.cli_version;
  if (env.node_version !== undefined) out.node_version = env.node_version;
  if (env.os !== undefined) out.os = env.os;
  if (env.timestamp !== undefined) out.timestamp = env.timestamp;

  // L-5: defense-in-depth deep walk. The named-field pass above only knows
  // about the declared BugReportEnvelope keys. If a future code path
  // attaches an ad-hoc nested object (e.g. `env.details = { partnerEmail:
  // "..." }`), the new strings would otherwise reach the bug-report payload
  // unredacted. The walker re-scans the full envelope and scrubs every
  // string it encounters. Idempotent — re-running redactString on already-
  // redacted text produces the same text. Depth-capped at 8.
  const deepRedacted = redactDeep(out, allTokens) as BugReportEnvelope;
  return deepRedacted;
}
