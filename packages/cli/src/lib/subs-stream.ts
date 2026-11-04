// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Subscription, PaginatedResponse } from "@pax8/core";
import type { Ora } from "ora";

/**
 * Materialize every page of subscriptions from a `SubscriptionsApi.streamAll`
 * (or its mock equivalent) iterator into a single array.
 *
 * Used by the aggregator commands — `dashboard`, `invoices audit`,
 * `recommendations list`, `recommendations upsell` — to compute over the
 * full portfolio instead of the first page (closes #613's silent-truncation
 * class). The future `pax8 subscriptions export` command (Phase 3) will
 * consume `streamAll` directly without materializing; this helper exists
 * because the four aggregators above do multi-pass work on the array
 * (filters, group-bys, joins) and aren't streamable without a substantial
 * refactor.
 *
 * `onProgress(loaded, total)` is called after each page so the caller can
 * keep its spinner honest on portfolios > 1000 subs. `total` is read from
 * the first page's `page.totalElements` and held stable across the
 * iteration — the server reports the same value on every page.
 */
export async function collectAllSubscriptions(
  stream: AsyncIterableIterator<PaginatedResponse<Subscription>>,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Subscription[]> {
  const all: Subscription[] = [];
  for await (const result of stream) {
    all.push(...result.content);
    onProgress?.(all.length, result.page.totalElements);
  }
  return all;
}

/**
 * Convenience wrapper: drive `collectAllSubscriptions` with a spinner-text
 * progress callback. The four aggregator commands share this exact pattern
 * — only update spinner text when the portfolio is big enough to matter
 * (>1000 subs, the per-page boundary), and use a single consistent message
 * shape so partners see the same UX across `dashboard`, `audit`,
 * `recommendations`, etc.
 *
 * `spinnerLabel` is the singular noun describing what's being loaded
 * ("dashboard", "invoice audit", "recommendations"). The helper formats
 * the running tally as `Loading <label>... (X of Y subscriptions)`.
 */
export async function collectSubsWithSpinner(
  stream: AsyncIterableIterator<PaginatedResponse<Subscription>>,
  spinner: Ora,
  spinnerLabel: string,
): Promise<Subscription[]> {
  return collectAllSubscriptions(stream, (loaded, total) => {
    if (total > 1000) {
      spinner.text = `Loading ${spinnerLabel}... (${loaded.toLocaleString()} of ${total.toLocaleString()} subscriptions)`;
    }
  });
}
