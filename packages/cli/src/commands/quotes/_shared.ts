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
import { validateEnum } from "../../lib/validate.js";

/**
 * Shared helpers for the line-item construction path that both
 * `quotes line-items add` and the `quotes create` shorthand use (#426).
 *
 * The two commands share the same wire-level operation
 * (`POST /v2/quotes/{id}/line-items`) and must accept the same flag surface
 * — anything `line-items add` understands, the shorthand needs to mirror so
 * partners don't unknowingly produce incomplete line items (Fred Lintz
 * domain-review finding).
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
}

export async function buildLineItemPayload(
  ctx: CommandContext,
  product: Product,
  quantity: number,
  options: LineItemFlagOptions,
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

  return {
    input: {
      productId: product.id,
      quantity,
      billingTerm,
      effectiveDate,
      price,
    },
    price,
    priceWasOverridden: priceOverride !== undefined,
    effectiveDate,
    billingTerm,
  };
}
