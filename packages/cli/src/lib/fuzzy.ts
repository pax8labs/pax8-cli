// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Small pure-function fuzzy match helpers. First introduced for
 * `pax8 explain <term>` (#656) so partners get did-you-mean suggestions
 * on unknown glossary terms. Kept generic so other commands can call
 * `suggest()` for their own unknown-input paths.
 */

/**
 * Iterative two-row Levenshtein edit distance. Case-sensitive; the caller
 * lower-cases inputs when case shouldn't matter. Returns the number of
 * single-character insertions, deletions, or substitutions between `a`
 * and `b`.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Two-row DP: `prev` is the previous row of the edit matrix, `curr`
  // fills as we iterate. We don't need the full matrix — only the last
  // row — so this is O(min(a.length, b.length)) space.
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,       // insertion
        prev[j] + 1,           // deletion
        prev[j - 1] + cost,    // substitution
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }

  return prev[b.length];
}

export interface SuggestOptions {
  /** Max suggestions returned. Default 3. */
  max?: number;
  /**
   * Maximum edit distance allowed. Default `min(3, floor(input.length * 0.4))`
   * — tighter for short inputs so a 3-character typo doesn't match every
   * 3-character candidate.
   */
  threshold?: number;
}

/**
 * Return up to `opts.max` candidates whose lower-cased edit distance to
 * `input` is ≤ `opts.threshold`. Sorted by ascending distance, ties broken
 * alphabetically for stable output.
 */
export function suggest(
  input: string,
  candidates: readonly string[],
  opts?: SuggestOptions,
): string[] {
  const max = opts?.max ?? 3;
  const threshold = opts?.threshold ?? Math.min(3, Math.floor(input.length * 0.4));
  const needle = input.toLowerCase();

  const scored: Array<{ candidate: string; distance: number }> = [];
  for (const c of candidates) {
    const d = levenshtein(needle, c.toLowerCase());
    if (d <= threshold) scored.push({ candidate: c, distance: d });
  }

  scored.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.candidate.localeCompare(b.candidate);
  });

  return scored.slice(0, max).map((s) => s.candidate);
}
