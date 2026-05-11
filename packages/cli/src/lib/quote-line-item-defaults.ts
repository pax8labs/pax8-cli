// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import {
  ERROR_INVALID_INPUT,
  type BillingTerm,
  type ProductPricingPlan,
} from "@pax8/core";
import { CliError } from "./errors.js";
import type { CommandContext } from "./context.js";

/**
 * Defaults for the `effectiveDate` and `price` fields the v2 quoting API
 * requires on `AddStandardLineItemPayload`. Shared between
 * `quotes line-items add` (#312) and `quotes create` (#311), which both
 * orchestrate a `POST /v2/quotes/{id}/line-items` call.
 */

/**
 * Normalize a user-supplied `YYYY-MM-DD` (or the default of "today, UTC") to
 * the ISO 8601 date-time string the v2 quoting API requires. The output is
 * always midnight UTC of the chosen day — line-item effective dates are
 * day-grained upstream, and pinning the time avoids zone-relative day shifts.
 */
export function resolveEffectiveDate(raw: string | undefined): string {
  if (!raw) {
    const now = new Date();
    return `${now.toISOString().slice(0, 10)}T00:00:00Z`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new CliError(
      `Invalid --effective-date: "${raw}"`,
      ["Use the YYYY-MM-DD format (e.g. 2026-06-01)"],
      undefined,
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (isNaN(parsed.getTime())) {
    throw new CliError(
      `Invalid --effective-date: "${raw}"`,
      ["Use a real calendar date in YYYY-MM-DD form"],
      undefined,
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  return `${raw}T00:00:00Z`;
}

const pricingCache = new Map<string, ProductPricingPlan[]>();

/**
 * Resolve the default per-unit list price for a product at a given billing
 * term. Returns `suggestedRetailPrice` from the first matching pricing plan.
 * Returns `undefined` if the product has no pricing or no plan for the
 * chosen term — callers fall back to requiring `--price`.
 */
export async function resolveListPrice(
  ctx: CommandContext,
  productId: string,
  billingTerm: BillingTerm,
): Promise<number | undefined> {
  let pricing = pricingCache.get(productId);
  if (!pricing) {
    try {
      pricing = await ctx.api.products.getPricing(productId);
      pricingCache.set(productId, pricing);
    } catch {
      return undefined;
    }
  }
  if (!pricing || pricing.length === 0) return undefined;

  const want = billingTerm.toLowerCase();
  const plan =
    pricing.find((p) => p.billingTerm.toLowerCase() === want)
    ?? (want.includes("annual") || want.includes("yearly")
      ? pricing.find(
          (p) =>
            p.billingTerm.toLowerCase().includes("annual")
            || p.billingTerm.toLowerCase().includes("yearly"),
        )
      : undefined)
    ?? (want.includes("month")
      ? pricing.find((p) => p.billingTerm.toLowerCase().includes("month"))
      : undefined);

  if (!plan) return undefined;

  const rate = plan.rates?.[0];
  return rate?.suggestedRetailPrice;
}
