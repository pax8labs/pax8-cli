// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";
import type { CommandContext } from "./context.js";
import { debugLog } from "./debug.js";

/** Minimal shape needed by enrichProductNames — any object with productId and optional productName. */
interface EnrichableByProduct {
  productId: string;
  productName?: string;
}

/** Minimal shape needed by enrichCompanyNames — any object with companyId and optional companyName. */
interface EnrichableByCompany {
  companyId: string;
  companyName?: string;
}

// #478 / #483: when a list page references company IDs not covered by the
// first companies page, walk additional pages until every referenced ID is
// resolved (or the catalog is exhausted). Capped so a misbehaving server
// can't put us in an unbounded loop — the cap mirrors the platform's largest
// observed partner (1000 customers) split across 10 pages of 1000.
const COMPANIES_ENRICHMENT_MAX_PAGES = 10;
const COMPANIES_ENRICHMENT_PAGE_SIZE = 1000;

/**
 * Build a `{ companyId → companyName }` lookup map covering every ID
 * referenced in the supplied rows. Pages `companies.list` until every
 * needed ID is resolved or the catalog is exhausted (whichever comes
 * first), with a guardrail cap of 10×1000 rows.
 *
 * Replaces the legacy `companies.list({ size: 200 })` pattern that left
 * the Company column blank for any portfolio bigger than 200 customers.
 * Best-effort: a failed companies fetch is logged via `debugLog` and
 * paging stops — the list still renders, just with un-enriched cells.
 *
 * Surfaces a stderr warning if names remain unresolved after the cap so
 * partners don't see blank cells with no explanation (#483).
 */
export async function buildCompanyNameMap(
  ctx: CommandContext,
  rows: { companyId?: string }[],
  options: { quiet?: boolean; resourceLabel?: string } = {},
): Promise<Map<string, string>> {
  const needed = new Set<string>();
  for (const row of rows) {
    if (row.companyId) needed.add(String(row.companyId));
  }
  const nameMap = new Map<string, string>();
  if (needed.size === 0) return nameMap;

  for (let page = 0; page < COMPANIES_ENRICHMENT_MAX_PAGES; page++) {
    let result;
    try {
      result = await ctx.api.companies.list({
        page,
        size: COMPANIES_ENRICHMENT_PAGE_SIZE,
      });
    } catch (err) {
      // Enrichment is best-effort — a failed companies fetch shouldn't
      // sink the list. Log for diagnostics and stop paging.
      debugLog("companies enrichment fetch failed", err);
      break;
    }
    for (const c of result.content as { id: string; name: string }[]) {
      nameMap.set(c.id, c.name);
    }
    // Early-exit: every referenced ID is now covered.
    const stillMissing = [...needed].some((id) => !nameMap.has(id));
    if (!stillMissing) break;
    // Out of pages on the wire — no point looping further.
    if (page + 1 >= result.page.totalPages) break;
  }

  const unresolved = [...needed].filter((id) => !nameMap.has(id));
  if (unresolved.length > 0 && !options.quiet) {
    const resource = options.resourceLabel ?? "row";
    const plural = unresolved.length === 1 ? "" : "s";
    process.stderr.write(
      chalk.dim(
        `  ⚠ ${unresolved.length} ${resource}${plural} reference companies outside the first ${
          COMPANIES_ENRICHMENT_MAX_PAGES * COMPANIES_ENRICHMENT_PAGE_SIZE
        } customers — Company column will show a placeholder.\n`,
      ),
    );
  }
  return nameMap;
}

/**
 * Fetch every company in the tenant by walking `companies.list` until the
 * catalog is exhausted. Used by callers (recommendations engine, portfolio
 * coverage) that need to reason over the FULL customer set, not just the
 * subset referenced by a specific list of rows.
 *
 * Guardrailed to the same 10×1000 cap as `buildCompanyNameMap`. Returns
 * a flat array of `{ id, name, ...rest }` records — caller decides how
 * to consume them.
 */
export async function fetchAllCompanies(
  ctx: CommandContext,
): Promise<{ id: string; name: string }[]> {
  const all: { id: string; name: string }[] = [];
  for (let page = 0; page < COMPANIES_ENRICHMENT_MAX_PAGES; page++) {
    let result;
    try {
      result = await ctx.api.companies.list({
        page,
        size: COMPANIES_ENRICHMENT_PAGE_SIZE,
      });
    } catch (err) {
      debugLog("fetchAllCompanies fetch failed", err);
      break;
    }
    all.push(...(result.content as { id: string; name: string }[]));
    if (page + 1 >= result.page.totalPages) break;
  }
  return all;
}

/**
 * When the set of missing product IDs is at or below this threshold we fetch
 * each one individually (in parallel) instead of pulling the entire 500-row
 * catalog. Sized so that `Promise.all` over the batch doesn't risk tripping
 * the API's per-minute rate limit even on chatty terminals.
 */
const PER_ID_FETCH_THRESHOLD = 25;

/**
 * Enrich subscriptions with product names when the API only returns productId.
 *
 * Strategy: collect the unique missing product IDs first. If the set is small
 * (<= PER_ID_FETCH_THRESHOLD), fetch each via `products.get(id)` in parallel —
 * this avoids pulling 500 catalog rows for a portfolio with a handful of
 * unique products. For larger sets, fall back to the bulk `products.list`
 * path (with per-id fill-in for anything still unresolved).
 *
 * Accepts typed subscription arrays (e.g. Subscription[]) as well as
 * Record<string, unknown>[] for backward compatibility.
 */
export async function enrichProductNames(
  ctx: CommandContext,
  subs: EnrichableByProduct[] | Record<string, unknown>[],
): Promise<void> {
  // Collect unique product IDs that need names
  const missing = new Set<string>();
  for (const s of subs) {
    const sub = s as Record<string, unknown>;
    if (!sub.productName || String(sub.productName).startsWith("Product ")) {
      const pid = String(sub.productId ?? "");
      if (pid) missing.add(pid);
    }
  }
  if (missing.size === 0) return;

  const nameMap = new Map<string, string>();

  if (missing.size <= PER_ID_FETCH_THRESHOLD) {
    // Narrow path: fetch only the IDs we need, in parallel.
    await Promise.all(
      [...missing].map(async (pid) => {
        try {
          const product = await ctx.api.products.get(pid);
          if (product?.name) nameMap.set(pid, product.name);
        } catch (err) {
          debugLog(`product lookup failed for ${pid}`, err);
        }
      })
    );
  } else {
    // Wide path: bulk fetch the catalog, then fill in any stragglers.
    try {
      const result = await ctx.api.products.list({ size: 500 });
      for (const product of result.content) {
        if (missing.has(product.id)) {
          nameMap.set(product.id, product.name);
        }
      }
    } catch (err) {
      debugLog("bulk product fetch failed", err);
    }

    const stillMissing = [...missing].filter((pid) => !nameMap.has(pid));
    if (stillMissing.length > 0) {
      const BATCH_SIZE = 15;
      for (let i = 0; i < stillMissing.length; i += BATCH_SIZE) {
        const batch = stillMissing.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (pid) => {
            try {
              const product = await ctx.api.products.get(pid);
              if (product?.name) nameMap.set(pid, product.name);
            } catch (err) {
              if (process.env.PAX8_DEBUG) process.stderr.write(`[debug] product lookup failed for ${pid}: ${err}\n`);
            }
          })
        );
      }
    }
  }

  // Apply names
  for (const s of subs) {
    const sub = s as Record<string, unknown>;
    if (!sub.productName || String(sub.productName).startsWith("Product ")) {
      const name = nameMap.get(String(sub.productId));
      if (name) sub.productName = name;
    }
  }
}

/**
 * Enrich subscriptions with company names using a pre-built lookup map.
 * Replaces companyName when it is missing or still set to the raw companyId.
 *
 * Accepts typed subscription arrays (e.g. Subscription[]) as well as
 * Record<string, unknown>[] for backward compatibility.
 */
export function enrichCompanyNames(
  companyNames: Map<string, string>,
  subs: EnrichableByCompany[] | Record<string, unknown>[],
): void {
  for (const s of subs) {
    const sub = s as Record<string, unknown>;
    if (!sub.companyName || String(sub.companyName) === sub.companyId) {
      const name = companyNames.get(String(sub.companyId ?? ""));
      if (name) sub.companyName = name;
    }
  }
}
