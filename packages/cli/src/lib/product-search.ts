// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CommandContext } from "./context.js";

// Element type of whatever `products.list` returns — the live and demo
// clients' product shapes differ slightly.
type CatalogProduct = Awaited<ReturnType<CommandContext["api"]["products"]["list"]>>["content"][number];

// The live /products endpoint caps `size` at 100 — `size: 200` silently
// returns 100 rows (verified 2026-11-06), so ask for what it will serve.
const PAGE_SIZE = 100;
// 3,000 rows: more than the whole catalog (~2,400) today. The rarest word of
// a real query is usually one or two pages ("Premium" ~150 rows); only a
// one-word query like "Microsoft" (~1,900) walks most of it.
export const PRODUCT_SEARCH_MAX_ROWS = 3_000;
const MAX_PAGES = PRODUCT_SEARCH_MAX_ROWS / PAGE_SIZE;
const PAGE_CONCURRENCY = 8;

export interface ProductSearchResult {
  products: CatalogProduct[];
  /** The catalog had more rows for the chosen keyword than were scanned. */
  truncated: boolean;
}

/**
 * Find every catalog product whose name contains all the words of `query`.
 *
 * The API's `search` param is no reference for this: multi-word values are
 * matched fuzzily ("Premium Microsoft" → 1 result) and single words return
 * every name containing them, so the old approach — longest word, first page
 * of 200, filter client-side — sent "Microsoft" (~1,900 rows) for
 * "Microsoft 365 Business Premium" and missed the product entirely (#757).
 *
 * Instead: count each word's matches with a size-1 request, page through the
 * results for the RAREST word, and filter client-side. Any name containing
 * every word contains the rarest one, so this misses nothing up to the row
 * cap — and the rarest word is usually a page or two.
 *
 * One limit is the API's: a single-word `search` matches at word starts, so
 * a word that only appears mid-word is not found through it ("365" finds
 * "Microsoft 365" but not "M365", "teams" misses "Call2Teams").
 */
export async function searchProducts(
  ctx: CommandContext,
  query: string,
  options: { vendorName?: string } = {},
): Promise<ProductSearchResult> {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  const matches = (p: CatalogProduct) => {
    const name = p.name.toLowerCase();
    return words.every((w) => name.includes(w));
  };
  // What the API is asked about: the query's words with punctuation split
  // off. The server mishandles punctuation — `(no` matches ~1,000 rows.
  const apiWords = [...new Set(words.flatMap((w) => w.split(/[^\p{L}\p{N}]+/u)).filter(Boolean))];

  let keyword: string | undefined = apiWords[0];
  if (apiWords.length > 1) {
    const totals = await Promise.all(
      apiWords.map(async (w) => {
        const r = await ctx.api.products.list({ vendorName: options.vendorName, search: w, size: 1 });
        return { w, total: r.page.totalElements };
      }),
    );
    // A word with no matches means no name can contain every word.
    if (totals.some((t) => t.total === 0)) return { products: [], truncated: false };
    keyword = totals.reduce((best, t) => (t.total < best.total ? t : best)).w;
  }

  const fetchPage = (page: number) =>
    ctx.api.products.list({ vendorName: options.vendorName, search: keyword, size: PAGE_SIZE, page });
  const first = await fetchPage(0);
  const pages: Array<{ content: CatalogProduct[] }> = [first];
  const lastPage = Math.min(first.page.totalPages, MAX_PAGES);
  // The first page tells us how many there are, so fetch the rest in
  // bounded parallel batches rather than one round-trip at a time.
  for (let start = 1; start < lastPage; start += PAGE_CONCURRENCY) {
    const batch = [];
    for (let page = start; page < Math.min(start + PAGE_CONCURRENCY, lastPage); page++) batch.push(fetchPage(page));
    pages.push(...(await Promise.all(batch)));
  }
  const products = pages.flatMap((r) => r.content).filter(matches);
  const truncated = first.page.totalPages > MAX_PAGES;
  return { products, truncated };
}
