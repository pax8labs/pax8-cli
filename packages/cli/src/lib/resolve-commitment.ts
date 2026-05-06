// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CommandContext } from "./context.js";

/**
 * Result of looking up the commitment-term attached to a partner's
 * existing active subscription for a given product.
 *
 * `id` is the value to pass back to the API as `commitmentTermId` on a
 * follow-on order; `term` is the human-readable label ("Monthly",
 * "1-Year", "3-Year") which callers may want to surface to the user
 * when they didn't ask for a specific term up front.
 */
export interface CommitmentTermInfo {
  id: string;
  term?: string;
}

/**
 * Find the commitment term info for a given (companyId, productId) pair
 * by scanning the company's active subscriptions for one matching the
 * product. Returns null if no matching subscription is found.
 *
 * Used by `orders/create` and `recommendations/{list,act}` to attach the
 * existing commitment term to a new order so prices align with what the
 * partner already has, rather than the API's default. `commitmentTermId`
 * UUIDs are product-specific and cannot be reused across products.
 *
 * If `preferredTerm` is provided (e.g. user passed `--commitment-term
 * Annual`), the helper prefers a subscription whose `commitment.term`
 * matches it, falling back to the first matching subscription. This
 * mirrors the orders/create call site's "user said Annual, find an
 * Annual sub" behavior. Recommendations callers leave it undefined and
 * get the first match.
 *
 * Errors during the API call are swallowed (returns null) — this is a
 * best-effort hint, not a hard requirement. The caller decides whether
 * a missing term should be a warning or an error.
 */
export async function resolveCommitmentTermId(
  ctx: CommandContext,
  companyId: string,
  productId: string,
  preferredTerm?: string,
): Promise<CommitmentTermInfo | null> {
  try {
    const subs = await ctx.api.subscriptions.list({
      companyId,
      status: "Active",
    });
    const matches = subs.content.filter(
      (s) => s.productId === productId && s.commitment?.id,
    );
    const match = (preferredTerm
      ? matches.find((s) => s.commitment?.term === preferredTerm)
      : null
    ) ?? matches[0];
    if (!match?.commitment?.id) return null;
    return {
      id: match.commitment.id,
      term: match.commitment.term,
    };
  } catch (err) {
    if (process.env.PAX8_DEBUG) {
      process.stderr.write(`[debug] resolveCommitmentTermId failed: ${err}\n`);
    }
    return null;
  }
}
