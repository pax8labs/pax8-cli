// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

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
