// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { ERROR_PRODUCT_NOT_FOUND, type Product } from "@pax8/core";
import type { CommandContext } from "./context.js";
import { CliError } from "./errors.js";
import { replCmd } from "./confirm.js";
import { searchProducts } from "./product-search.js";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "by", "with",
]);

// A single keyword for the "Did you mean" lookup on a miss — not for finding
// the product itself, which searchProducts does. Longest non-stopword token.
function pickKeyword(tokens: string[]): string | undefined {
  const candidates = tokens.filter(
    (t) => t.length >= 4 && !STOPWORDS.has(t.toLowerCase())
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, t) => (t.length >= best.length ? t : best));
}

/**
 * Resolve a product by ID or name. Supports exact match and fuzzy (substring) match.
 * Returns the full product object.
 */
export async function resolveProduct(ctx: CommandContext, input: string): Promise<Product> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(input);
  if (isUuid) return ctx.api.products.get(input);

  // If it looks like an ID (contains dashes but isn't a UUID, e.g. "prod-m365-biz-prem-0001"),
  // try a direct get before falling back to name search
  if (input.includes("-")) {
    try {
      return await ctx.api.products.get(input);
    } catch { /* not found by ID, try name search */ }
  }

  // Every catalog product whose name contains all the input's words (#757).
  // The old lookup scanned one page of a single-keyword search, so "unique
  // substring match" meant unique within ~100 rows: "Microsoft 365 E3"
  // resolved to a Defender add-on, and exact names past that page failed.
  const { products: candidates } = await searchProducts(ctx, input);
  const lower = input.toLowerCase();

  const exact = candidates.find((p) => p.name.toLowerCase() === lower);
  if (exact) return exact as Product;

  // Prefer names that contain the input as one phrase, then any order.
  const phrase = candidates.filter((p) => p.name.toLowerCase().includes(lower));
  const pool = phrase.length > 0 ? phrase : candidates;
  if (pool.length === 1) return pool[0] as Product;
  if (pool.length > 1) {
    // #408: include IDs in the "Did you mean" list so the user can
    // copy/paste a canonical match instead of round-tripping through
    // `pax8 products search`.
    const lines = pool
      .slice(0, 5)
      .map((p) => `  ${p.name} (${p.id})`)
      .join("\n");
    throw new CliError(
      `Multiple products match "${input}"`,
      [`${pool.length} products match. Use an exact name or product ID.`],
      [`Did you mean:\n${lines}`],
      undefined,
      ERROR_PRODUCT_NOT_FOUND,
    );
  }

  // #408: surface inline "Did you mean" suggestions on a not-found miss
  // rather than only pointing the user at `pax8 products search`. Nothing
  // contains every word, so fetch one page for the longest word and rank
  // it by token overlap against the input. Best-effort: a failed lookup
  // just means no suggestions.
  const recoverySteps: string[] = [];
  const tokens = input.split(/\s+/).filter(Boolean);
  const nearby = await ctx.api.products
    .list({ search: pickKeyword(tokens) ?? tokens[0], size: 100 })
    .then((r) => r.content, () => []);
  const suggestions = rankProductSuggestions(input, nearby).slice(0, 3);
  if (suggestions.length > 0) {
    const lines = suggestions.map((p) => `  ${p.name} (${p.id})`).join("\n");
    recoverySteps.push(`Did you mean:\n${lines}`);
  }
  recoverySteps.push(`Try ${replCmd("pax8 products search")} "${input}" to browse the catalog.`);

  throw new CliError(
    `Product not found: "${input}"`,
    ["No product in the catalog matched the supplied name or ID."],
    recoverySteps,
    undefined,
    ERROR_PRODUCT_NOT_FOUND,
  );
}

/**
 * Token-overlap ranking for "Did you mean" suggestions. Order:
 *   1. Most input tokens contained in the product name (descending)
 *   2. Shorter product name as a tie-breaker (more specific matches first)
 *
 * Excludes products with zero token overlap so we never surface
 * irrelevant suggestions just to pad the list.
 */
function rankProductSuggestions(
  input: string,
  candidates: Array<{ id: string; name: string }>,
): Array<{ id: string; name: string }> {
  const inputTokens = input
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  if (inputTokens.length === 0) return [];

  const scored = candidates
    .map((p) => {
      const name = p.name.toLowerCase();
      const hits = inputTokens.filter((t) => name.includes(t)).length;
      return { p, hits };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => {
      if (b.hits !== a.hits) return b.hits - a.hits;
      return a.p.name.length - b.p.name.length;
    });

  return scored.map((s) => s.p);
}
