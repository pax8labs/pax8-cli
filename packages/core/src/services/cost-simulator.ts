// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { ProductPricingPlan } from "../api/types.js";
import { subscriptionMrr } from "./analytics.js";

/**
 * The "current" subscription state — what the partner already has on the
 * customer today. Optional: omit when modeling a brand-new add.
 */
export interface SimulationCurrent {
  productId: string;
  productName: string;
  quantity: number;
  billingTerm: string;
  /** Per-seat unit price already on the existing subscription. */
  price: number;
}

/**
 * The "proposed" subscription change. `billingTerm` defaults to the current
 * billingTerm (when there is one) or "Annual" (when there isn't).
 */
export interface SimulationProposed {
  productId: string;
  productName: string;
  quantity: number;
  billingTerm?: string;
}

export interface SimulationInput {
  /** Current subscription, if any. Omit for "add new product". */
  current?: SimulationCurrent;
  proposed: SimulationProposed;
  /**
   * Pricing plans for the proposed product (the same shape returned by
   * `ProductsApi.getPricing()`). Used to look up the proposed unit price.
   */
  pricing: ProductPricingPlan[];
}

export interface SimulationLeg {
  unitPrice: number;
  quantity: number;
  monthly: number;
  annual: number;
  productName: string;
  billingTerm: string;
}

export interface SimulationDelta {
  monthly: number;
  annual: number;
  /** Per-seat monthly delta. Falls back to per-seat for whichever side has seats. */
  perSeat: number;
}

export interface SimulationResult {
  current: SimulationLeg | null;
  proposed: SimulationLeg;
  delta: SimulationDelta;
  notes: string[];
}

/**
 * Round to 2 decimal places — matches `formatCurrency` precision so the
 * structured result and the rendered table never disagree about a penny.
 */
function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Normalize a billing term string to a canonical "Monthly" or "Annual" label
 * for display. Falls through any other value so commitment-style terms
 * (e.g. "1-Year", "3-Year") still appear sensibly in notes/output.
 */
function normalizeTerm(term: string): string {
  const lower = term.toLowerCase();
  if (lower.includes("month")) return "Monthly";
  if (lower.includes("annual") || lower.includes("yearly") || lower.includes("year")) {
    if (lower.includes("year") && !lower.includes("annual") && !lower.includes("yearly")) {
      // Preserve commitment-style labels like "1-Year" / "2-Year" verbatim.
      return term;
    }
    return "Annual";
  }
  return term;
}

/**
 * Pick the rate row whose `startQuantityRange` is the largest value still
 * <= `quantity`. Mirrors the volume-tier resolution that
 * `commands/orders/create.ts` relies on (which currently just takes
 * `rates[0]` because demo data has a single rate per plan, but real Pax8
 * pricing can carry multiple tiers).
 */
function pickRate(plan: ProductPricingPlan, quantity: number): { unitPrice: number; tierStart: number } {
  const rates = plan.rates ?? [];
  if (rates.length === 0) {
    throw new Error(`Pricing plan for "${plan.productName ?? plan.productId}" has no rate rows`);
  }

  // Sort by startQuantityRange ascending; rows without one are treated as 0.
  const sorted = [...rates].sort(
    (a, b) => (a.startQuantityRange ?? 0) - (b.startQuantityRange ?? 0),
  );

  let chosen = sorted[0];
  for (const r of sorted) {
    if ((r.startQuantityRange ?? 0) <= quantity) {
      chosen = r;
    } else {
      break;
    }
  }
  return {
    unitPrice: chosen.suggestedRetailPrice,
    tierStart: chosen.startQuantityRange ?? 0,
  };
}

/**
 * Find the pricing plan matching a billing term. Match is case-insensitive
 * and tolerant of "Annual" vs "Yearly" naming.
 */
function findPlan(
  pricing: ProductPricingPlan[],
  billingTerm: string,
): ProductPricingPlan | undefined {
  if (pricing.length === 0) return undefined;
  const want = billingTerm.toLowerCase();
  // Exact match first
  const exact = pricing.find((p) => p.billingTerm.toLowerCase() === want);
  if (exact) return exact;
  // Annual ≈ Yearly fallback
  if (want.includes("annual") || want.includes("yearly")) {
    return pricing.find(
      (p) =>
        p.billingTerm.toLowerCase().includes("annual") ||
        p.billingTerm.toLowerCase().includes("yearly"),
    );
  }
  if (want.includes("month")) {
    return pricing.find((p) => p.billingTerm.toLowerCase().includes("month"));
  }
  return undefined;
}

/**
 * Compute the financial impact of a single subscription change — SKU swap,
 * quantity change, billing-term swap, or add-new — without placing the
 * order. Pure compute over pricing data; safe to run anywhere.
 *
 * Returns a structured `SimulationResult` containing both legs of the
 * comparison (current vs. proposed), the delta, and human-readable notes
 * about any non-obvious choices the simulator made.
 */
export function simulateCostChange(input: SimulationInput): SimulationResult {
  const { current, proposed, pricing } = input;
  const notes: string[] = [];

  if (!pricing || pricing.length === 0) {
    throw new Error(
      `No pricing plans available for product "${proposed.productName}" (id: ${proposed.productId}). Cannot simulate.`,
    );
  }

  if (proposed.quantity < 0) {
    throw new Error(`Proposed quantity must be >= 0 (got ${proposed.quantity})`);
  }

  // Resolve the proposed billing term: explicit > current > default Annual.
  let proposedTerm = proposed.billingTerm;
  if (!proposedTerm) {
    if (current?.billingTerm) {
      proposedTerm = current.billingTerm;
    } else {
      proposedTerm = "Annual";
      notes.push("Annual term selected (default — typically cheaper than monthly)");
    }
  }

  const proposedPlan = findPlan(pricing, proposedTerm);
  if (!proposedPlan) {
    const available = [...new Set(pricing.map((p) => p.billingTerm))].join(", ");
    throw new Error(
      `No ${proposedTerm} pricing plan found for "${proposed.productName}". Available: ${available}`,
    );
  }

  const { unitPrice: proposedUnitPrice, tierStart: proposedTier } = pickRate(
    proposedPlan,
    proposed.quantity,
  );

  // Note the volume tier if it's not the entry-level (>= 1) tier.
  if (proposedTier > 1 && (proposedPlan.rates?.length ?? 0) > 1) {
    notes.push(
      `Volume tier applied: ${proposed.quantity} seats falls into the ${proposedTier}+ rate (${formatPriceShort(proposedUnitPrice)}/seat)`,
    );
  }

  const proposedNormalized = normalizeTerm(proposedPlan.billingTerm);
  const proposedMonthly = round2(
    subscriptionMrr(proposedUnitPrice, proposed.quantity, proposedPlan.billingTerm),
  );
  const proposedAnnual = round2(proposedMonthly * 12);

  const proposedLeg: SimulationLeg = {
    unitPrice: proposedUnitPrice,
    quantity: proposed.quantity,
    monthly: proposedMonthly,
    annual: proposedAnnual,
    productName: proposed.productName,
    billingTerm: proposedNormalized,
  };

  let currentLeg: SimulationLeg | null = null;
  if (current) {
    const currentMonthly = round2(
      subscriptionMrr(current.price, current.quantity, current.billingTerm),
    );
    const currentAnnual = round2(currentMonthly * 12);
    currentLeg = {
      unitPrice: current.price,
      quantity: current.quantity,
      monthly: currentMonthly,
      annual: currentAnnual,
      productName: current.productName,
      billingTerm: normalizeTerm(current.billingTerm),
    };

    // Note billing-term swap if the user is implicitly switching.
    if (
      normalizeTerm(current.billingTerm).toLowerCase() !==
      proposedNormalized.toLowerCase()
    ) {
      notes.push(
        `Switching from ${normalizeTerm(current.billingTerm)} to ${proposedNormalized} billing`,
      );
    }
  }

  const deltaMonthly = round2(proposedMonthly - (currentLeg?.monthly ?? 0));
  const deltaAnnual = round2(proposedAnnual - (currentLeg?.annual ?? 0));

  // Per-seat delta: difference in per-seat monthly cost. When quantities
  // match, this is meaningful as a "what does each user cost more/less now?"
  // value. When they differ, fall back to the proposed per-seat monthly
  // (the more useful number for "what does each new seat cost?").
  let perSeat: number;
  if (
    currentLeg &&
    currentLeg.quantity === proposedLeg.quantity &&
    proposedLeg.quantity > 0
  ) {
    perSeat = round2(
      proposedMonthly / proposedLeg.quantity -
        currentLeg.monthly / currentLeg.quantity,
    );
  } else if (proposedLeg.quantity > 0) {
    perSeat = round2(proposedMonthly / proposedLeg.quantity);
  } else {
    perSeat = 0;
  }

  return {
    current: currentLeg,
    proposed: proposedLeg,
    delta: { monthly: deltaMonthly, annual: deltaAnnual, perSeat },
    notes,
  };
}

/**
 * Compact dollar formatter for embedding inside notes (avoids a dependency
 * on the CLI-side `formatCurrency` helper so this stays runnable from the
 * core package or any embedder).
 */
function formatPriceShort(n: number): string {
  return `$${n.toFixed(2)}`;
}
