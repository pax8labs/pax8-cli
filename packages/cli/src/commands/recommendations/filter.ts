import type { Recommendation } from "@pax8/core";

export interface RecFilterOptions {
  company?: string;
  priority?: string;
  type?: string;
  product?: string;
}

/**
 * Shared filtering logic for recommendations — used by both `list` and `act`.
 * Supports company (exact, partial, contains), priority, type, and product name filters.
 */
export function filterRecommendations(recs: Recommendation[], options: RecFilterOptions): Recommendation[] {
  let filtered = recs;

  if (options.company) {
    const filter = options.company.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.companyId === options.company ||
        r.companyId.startsWith(filter) ||
        r.companyName.toLowerCase() === filter ||
        r.companyName.toLowerCase() === `[demo] ${filter}` ||
        r.companyName.toLowerCase().includes(filter)
    );
  }

  if (options.priority) {
    filtered = filtered.filter((r) => r.priority === options.priority!.toLowerCase());
  }

  if (options.type) {
    filtered = filtered.filter((r) => r.type === options.type!.toLowerCase());
  }

  if (options.product) {
    const pFilter = options.product.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        (r.suggestedProducts?.[0] ?? "").toLowerCase().includes(pFilter) ||
        r.title.toLowerCase().includes(pFilter)
    );
  }

  return filtered;
}
