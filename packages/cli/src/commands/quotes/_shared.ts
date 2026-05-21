// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import {
  BillingTermSchema,
  ERROR_INVALID_INPUT,
  type AddQuoteLineItemInput,
  type BillingTerm,
  type Product,
} from "@pax8/core";
import { CliError } from "../../lib/errors.js";
import type { CommandContext } from "../../lib/context.js";
import {
  resolveEffectiveDate,
  resolveListPrice,
} from "../../lib/quote-line-item-defaults.js";
import { resolveCommitmentTermId } from "../../lib/resolve-commitment.js";
import { validateEnum } from "../../lib/validate.js";

/**
 * Shared helpers for the line-item construction path that both
 * `quotes line-items add` and the `quotes create` shorthand use (#426).
 *
 * The two commands share the same wire-level operation
 * (`POST /v2/quotes/{id}/line-items`) and must accept the same flag surface
 * — anything `line-items add` understands, the shorthand needs to mirror so
 * partners don't unknowingly produce incomplete line items (domain-review
 * finding).
 *
 * The actual flag declarations stay on each command (so each command's
 * `--help` is self-documenting), but the validation + payload build live
 * here. The parity test at
 * `packages/cli/src/__tests__/quotes-create-line-items-parity.test.ts`
 * guards the user-facing contract.
 */

export const BILLING_TERM_VALUES = BillingTermSchema.options as readonly BillingTerm[];

/**
 * Raw flag options as they come off Commander — all strings (or undefined),
 * since Commander hands us untyped values. Shared by both call sites.
 */
export interface LineItemFlagOptions {
  quantity?: string;
  billingTerm?: string;
  price?: string;
  effectiveDate?: string;
  /**
   * Human-readable commitment-term enum (e.g. "Monthly", "1-Year", "3-Year").
   * Auto-resolved to a UUID against the partner's existing subscriptions —
   * same lookup path orders create uses. Mutually exclusive with
   * `commitmentTermId`, which takes precedence when both are supplied.
   */
  commitmentTerm?: string;
  /**
   * Commitment-term UUID. When supplied, this wins over any
   * `commitmentTerm` enum (no resolution lookup) — mirrors the orders create
   * precedence rule (`packages/cli/src/commands/orders/create.ts:290`).
   */
  commitmentTermId?: string;
}

/**
 * Parsed, validated quantity. Centralized so both commands surface the
 * same error shape (#426).
 */
export function parseQuantity(raw: string | undefined): number {
  const quantity = parseInt(raw ?? "1", 10);
  if (isNaN(quantity) || quantity <= 0) {
    throw new CliError(
      `Invalid quantity: "${raw}"`,
      ["Quantity must be a positive integer"],
      undefined,
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  return quantity;
}

/**
 * Parse and validate `--price` if supplied. Returns `undefined` when the
 * caller didn't pass the flag so the default-price lookup can run.
 */
export function parsePriceOverride(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CliError(
      `Invalid price: "${raw}"`,
      ["Price must be a non-negative number"],
      undefined,
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  return parsed;
}

/**
 * Validate `--billing-term` against the enum and return the canonical
 * value. Reuses `validateEnum()` (#412) so a typo fails before any
 * network call.
 */
export function parseBillingTerm(
  raw: string | undefined,
  cmdHint: string,
): BillingTerm {
  const value = raw ?? "Monthly";
  validateEnum(value, BILLING_TERM_VALUES, "--billing-term", { cmdHint });
  return value as BillingTerm;
}

/**
 * Build the `AddQuoteLineItemInput` payload from the parsed flag values
 * plus a resolved product. Encapsulates the "default to list price if
 * `--price` not supplied" lookup and the "no list price available" error
 * — the wire-shape contract that #312 pinned and #426 mirrors onto
 * `quotes create`.
 *
 * Returns the input plus the effective price + whether it was an override,
 * so callers can render the same preview line ("(override)" vs "(list)")
 * without duplicating the logic.
 */
export interface BuiltLineItemPayload {
  input: AddQuoteLineItemInput;
  price: number;
  priceWasOverridden: boolean;
  effectiveDate: string;
  billingTerm: BillingTerm;
  /**
   * Human-readable commitment-term label (e.g. "1-Year"). Populated either
   * because the caller passed `--commitment-term`, or because the UUID
   * passed via `--commitment-term-id` was resolved back to a term during
   * the existing-subscription lookup. Surfaced so callers can render the
   * commitment line in the preview block without re-doing the lookup.
   */
  commitmentTerm?: string;
  /** Commitment-term UUID, when resolved or supplied directly. */
  commitmentTermId?: string;
}

export async function buildLineItemPayload(
  ctx: CommandContext,
  product: Product,
  quantity: number,
  options: LineItemFlagOptions,
  companyId?: string,
): Promise<BuiltLineItemPayload> {
  const billingTerm = parseBillingTerm(options.billingTerm, "pax8 quotes line-items add");
  const priceOverride = parsePriceOverride(options.price);
  const effectiveDate = resolveEffectiveDate(options.effectiveDate);
  const price = priceOverride ?? (await resolveListPrice(ctx, product.id, billingTerm));

  if (price === undefined) {
    throw new CliError(
      `No list price found for "${product.name}" at billing term "${billingTerm}"`,
      [
        "Pass --price <number> to set the per-unit price explicitly",
        "Try a different --billing-term (Monthly or Annual)",
      ],
      undefined,
      undefined,
      ERROR_INVALID_INPUT,
    );
  }

  // Commitment-term resolution — mirrors orders create
  // (`packages/cli/src/commands/orders/create.ts:266-296`):
  //   • If `--commitment-term-id <uuid>` is supplied, it wins; no resolution.
  //   • Else if `--commitment-term <enum>` is supplied AND we have a
  //     companyId, look up an existing subscription for this product on the
  //     partner and reuse its commitment.id (so rates align with the partner's
  //     existing book — Model A canonical per the NCE proration spike).
  //   • Else leave both unset — the v2 wire `commitmentTermId` is optional
  //     for Monthly / no-commitment SKUs.
  let commitmentTerm = options.commitmentTerm;
  let commitmentTermId = options.commitmentTermId;
  if (!commitmentTermId && commitmentTerm && companyId) {
    const info = await resolveCommitmentTermId(
      ctx,
      companyId,
      product.id,
      commitmentTerm,
    );
    if (info) {
      commitmentTermId = info.id;
      if (!commitmentTerm) commitmentTerm = info.term;
    }
  }

  return {
    input: {
      productId: product.id,
      quantity,
      billingTerm,
      effectiveDate,
      price,
      ...(commitmentTermId ? { commitmentTermId } : {}),
    },
    price,
    priceWasOverridden: priceOverride !== undefined,
    effectiveDate,
    billingTerm,
    commitmentTerm,
    commitmentTermId,
  };
}
