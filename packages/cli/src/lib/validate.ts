// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { ALL_SUBS_PAGE_SIZE, ERROR_INVALID_INPUT } from "@pax8/core";
import { CliError } from "./errors.js";
import { replCmd } from "./confirm.js";

/**
 * Hard ceiling enforced on `--size <N>` across every paginated `list`
 * command. Mirrors `ALL_SUBS_PAGE_SIZE` from `@pax8/core` (1000) — the
 * same page-size the portfolio-wide read paths (dashboard, audit,
 * recommendations, MRR reports, renewals) already use.
 *
 * Why a hard cap, not a configurable knob: a partner / agent / CI
 * runner that asks for `--size 50000` against the orders endpoint
 * gets back ~34 MB of JSON (#518). That blows up context windows,
 * crashes `jq` pipelines, and OOMs CI runners — all without warning.
 * The cap forces a paged-iteration pattern (`--page 2 --size 1000`)
 * instead of a single mega-request.
 */
export const LIST_SIZE_CAP = ALL_SUBS_PAGE_SIZE;

/**
 * Clamp a user-supplied `--size <N>` to the global list-size cap and
 * report whether clamping happened.
 *
 * Contract:
 *   - `undefined` / `NaN` / non-positive values fall back to the
 *     caller-supplied default (commander's `--size <number>` default).
 *   - Values `≤ LIST_SIZE_CAP` pass through verbatim.
 *   - Values `> LIST_SIZE_CAP` clamp to `LIST_SIZE_CAP` and return
 *     `clamped: true` so the caller can emit a stderr warning.
 *
 * Designed for the existing commander pattern
 * `--option("--size <number>", "Page size", "25")` — the option value
 * arrives as a string. Callers pass `parseInt(allOpts.size, 10)` and
 * trust this helper to coerce out negatives / NaN.
 */
export function clampListSize(
  requested: number | undefined,
  defaultSize: number,
): { size: number; clamped: boolean; requested: number } {
  const fallback = Math.min(Math.max(defaultSize, 1), LIST_SIZE_CAP);
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
    return { size: fallback, clamped: false, requested: fallback };
  }
  if (requested > LIST_SIZE_CAP) {
    return { size: LIST_SIZE_CAP, clamped: true, requested };
  }
  return { size: requested, clamped: false, requested };
}

/**
 * Emit the canonical `--size clamped to N` warning to stderr. Kept
 * next to `clampListSize` so command sites are a single import + two
 * calls. Honors `PAX8_QUIET=1` and `--quiet` (caller passes `quiet`).
 */
export function warnSizeClamped(
  requested: number,
  cap: number = LIST_SIZE_CAP,
  options: { quiet?: boolean } = {},
): void {
  if (options.quiet) return;
  if (process.env.PAX8_QUIET === "1") return;
  process.stderr.write(
    `\n  ⚠ --size ${requested} clamped to ${cap} (max). ` +
      `Use --page <N> --size ${cap} for further results.\n`,
  );
}

/**
 * Fail-fast enum validation for CLI flag values.
 *
 * Contract:
 *   - `undefined` passes through (the user didn't supply the flag).
 *   - A value present in `allowed` returns the value, narrowed to `T`.
 *   - Anything else throws `CliError(ERROR_INVALID_INPUT)` with a
 *     human-readable list of accepted values so the user can self-correct
 *     without reading docs.
 *
 * Match policy is **case-sensitive by default**, mirroring how the Pax8
 * API treats its enums on the wire. A `lowercase: true` option is provided
 * for the rare server-side path that accepts mixed casing
 * (`quotes list --status` per #387) — we still surface the canonical form
 * in the error message so the user learns the exact set.
 *
 * Why this lives next to `errors.ts` rather than there: validation is a
 * separate concern from error formatting, and the partner-walkthrough
 * findings (#408) explicitly call for a centralized helper. Future input
 * shape checks (date ranges, postal codes, etc.) belong here too.
 *
 * Reference: `validateBillingTermInput()` in `subscriptions/update.ts`
 * predates this helper and stays as-is — that path needs the Zod schema's
 * runtime narrowing to `BillingTerm`. This generic helper is the floor
 * for everything else.
 */
export function validateEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flagName: string,
  options: { lowercase?: boolean; cmdHint?: string } = {},
): T | undefined {
  if (value === undefined) return undefined;
  const candidate = options.lowercase ? value.toLowerCase() : value;
  const allowedCompare = options.lowercase
    ? (allowed as readonly string[]).map((a) => a.toLowerCase())
    : (allowed as readonly string[]);
  const idx = allowedCompare.indexOf(candidate);
  if (idx >= 0) return allowed[idx];
  const hint = options.cmdHint
    ? `Run \`${replCmd(options.cmdHint + " --help")}\` for the full flag reference.`
    : "Run the command with --help to see the full flag reference.";
  throw new CliError(
    `Invalid value for ${flagName}: "${value}"`,
    [`Allowed: ${allowed.join(" | ")}`],
    [hint],
    undefined,
    ERROR_INVALID_INPUT,
  );
}

/**
 * Validate a `--month <YYYY-MM>` flag value.
 *
 * The string is interpolated verbatim into machine-readable
 * `nextActions[].command` strings emitted on stdout — which agents
 * (Claude Code's skill, scripts) are explicitly invited to extract and
 * execute. An unvalidated `--month "2026-01; rm -rf ~"` would round-trip
 * through that channel and turn a read command into a shell injection
 * vector. Validating at the parse boundary keeps the danger contained:
 * if the input isn't shaped like `YYYY-MM`, the command never runs.
 *
 * Contract:
 *   - `undefined` passes through (the user didn't supply the flag).
 *   - A string matching `/^\d{4}-\d{2}$/` with a month in 01–12 returns
 *     the value unchanged.
 *   - Anything else throws `CliError(ERROR_INVALID_INPUT)`.
 *
 * The year range is intentionally permissive (any 4-digit year) — we
 * don't want to reject the partner's legitimate 2019 invoice query
 * three years from now. The injection-risk-relevant check is the
 * shape: only digits and a single hyphen, no shell metacharacters.
 */
export function validateMonth(
  value: string | undefined,
  flagName = "--month",
): string | undefined {
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new CliError(
      `Invalid value for ${flagName}: "${value}"`,
      [`${flagName} must be in YYYY-MM format (e.g. 2026-03).`],
      [
        `Example: ${flagName} 2026-03`,
        "Use four-digit year, hyphen, two-digit month — no other characters.",
      ],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  const month = parseInt(value.slice(5, 7), 10);
  if (month < 1 || month > 12) {
    throw new CliError(
      `Invalid value for ${flagName}: "${value}"`,
      [`Month component must be 01–12; got "${value.slice(5, 7)}".`],
      [`Example: ${flagName} 2026-03`],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  return value;
}

/**
 * Comma-separated list variant of `validateEnum`. Returns the parsed
 * canonical values (deduplicated, original order). Empty / all-whitespace
 * input throws `ERROR_INVALID_INPUT` so the caller doesn't have to
 * special-case it.
 */
export function validateEnumList<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flagName: string,
  options: { cmdHint?: string } = {},
): T[] | undefined {
  if (value === undefined) return undefined;
  const parsed: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    parsed.push(trimmed);
  }
  if (parsed.length === 0) {
    throw new CliError(
      `At least one value is required for ${flagName}`,
      [`${flagName} must contain one or more comma-separated values from: ${allowed.join(", ")}`],
      [
        options.cmdHint
          ? `Try: \`${replCmd(options.cmdHint)} ${flagName} ${allowed[0]}\``
          : `Provide one of: ${allowed.join(", ")}`,
      ],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  const invalid = parsed.filter((t) => !(allowed as readonly string[]).includes(t));
  if (invalid.length > 0) {
    throw new CliError(
      `Invalid value for ${flagName}: ${invalid.map((v) => `"${v}"`).join(", ")}`,
      [`Allowed: ${allowed.join(" | ")}`],
      [
        options.cmdHint
          ? `Try: \`${replCmd(options.cmdHint)} ${flagName} ${allowed[0]}\``
          : `Pick one or more of: ${allowed.join(", ")}`,
      ],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  return parsed as T[];
}

/**
 * Fuzzy resolution with suggestions. The caller plugs in an exact-match
 * resolver and a top-3 search function — this helper just orchestrates
 * the "exact-match → suggest top-3 → throw" flow.
 *
 * On a miss it throws `CliError(ERROR_INVALID_INPUT)` with the top
 * matches rendered as `Did you mean:` recovery steps. The partner-
 * walkthrough finding #8 is the canonical case: a partner types
 * `--product "Microsoft 365"`, the exact match fails, and we want to
 * surface "Microsoft 365 Business Premium [NCE]" inline rather than
 * forcing them to round-trip through `pax8 products search`.
 *
 * Not used for `--company` today (`resolveCompany` already has its own
 * "multiple matches" path with the same shape); kept generic so future
 * resolvers can adopt the same UX.
 */
export interface ResolveSuggestion {
  id: string;
  name: string;
}

export async function resolveWithSuggestions<T>(
  query: string,
  exactMatch: (q: string) => Promise<T | null>,
  searchTop: (q: string) => Promise<ResolveSuggestion[]>,
  noun: string,
  options: { searchCmd?: string; topN?: number } = {},
): Promise<T> {
  const direct = await exactMatch(query);
  if (direct) return direct;

  const topN = options.topN ?? 3;
  let matches: ResolveSuggestion[] = [];
  try {
    matches = (await searchTop(query)).slice(0, topN);
  } catch {
    // The search call is best-effort — if it fails (rate limit, transient
    // 5xx), still throw a useful not-found error rather than masking the
    // original miss with a search failure.
  }

  const recoverySteps: string[] = [];
  if (matches.length > 0) {
    const list = matches.map((m) => `  ${m.name} (${m.id})`).join("\n");
    recoverySteps.push(`Did you mean:\n${list}`);
  } else {
    recoverySteps.push("No close matches found in the catalog.");
  }
  if (options.searchCmd) {
    recoverySteps.push(
      `Browse all matches: \`${replCmd(options.searchCmd)} "${query}"\``,
    );
  }

  throw new CliError(
    `${noun} "${query}" not found`,
    [`No exact match for "${query}" in the catalog.`],
    recoverySteps,
    undefined,
    ERROR_INVALID_INPUT,
  );
}
