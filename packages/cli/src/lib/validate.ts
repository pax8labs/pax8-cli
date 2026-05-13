// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { ERROR_INVALID_INPUT } from "@pax8/core";
import { CliError } from "./errors.js";
import { replCmd } from "./confirm.js";

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
