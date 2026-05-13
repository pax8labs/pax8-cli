// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Pax8Client, RequestOpts } from "./client.js";
import {
  QuoteSchema,
  PaginatedResponseSchema,
  type Quote,
  type CreateQuoteInput,
  type UpdateQuoteInput,
  type AddQuoteLineItemInput,
  type QuoteStatusTransition,
  type PaginatedResponse,
} from "./types.js";

const PaginatedQuoteSchema = PaginatedResponseSchema(QuoteSchema);

/**
 * Per-call routing options for `QuotesApi`. Quotes are the only Pax8 partner
 * surface that lives at `/v2`; every other resource uses the default `/v1`
 * from the shared base URL. The `Pax8Client` accepts a `RequestOpts` argument
 * with `apiVersion` to override the version segment per call — every call in
 * this class passes `V2`. See #307 and `docs/triage/quotes-api-version.md`.
 */
const V2: RequestOpts = { apiVersion: "v2" };

/**
 * The five fields the v2 spec marks required on every `PUT /v2/quotes/{id}`.
 * Both `update()` and `setStatus()` ride this shape — there is no separate
 * status-transition endpoint, so a status flip and a date change both PUT
 * the same all-five-required body. See #313, #314,
 * `docs/triage/quotes-api-version.md` §9.1.
 */
export interface FullUpdateQuotePayload {
  expiresOn: string;
  introMessage: string;
  published: boolean;
  status: QuoteStatusTransition;
  termsAndDisclaimers: string;
}

/**
 * Project a fetched `Quote` plus a partial override into the full 5-field
 * body `PUT /v2/quotes/{id}` requires. Shared by `update` and `setStatus`
 * so both write paths land identical bytes on the wire.
 *
 * `expiresOn` is technically optional on the read shape (a draft quote may
 * not have one yet) but required on the PUT — callers must supply it via
 * `overrides` when the current quote lacks it; otherwise the API will 4xx.
 * `status` on the read shape is a permissive string (mixed-case legacy demo
 * values are tolerated); we lowercase it before serializing to match the
 * v2 enum.
 */
export function buildFullUpdatePayload(
  current: Quote,
  overrides: UpdateQuoteInput,
): FullUpdateQuotePayload {
  const status =
    overrides.status
    ?? (current.status.toLowerCase() as QuoteStatusTransition);
  // `published` is optional on the read shape; default to `false` for drafts.
  const published = overrides.published ?? current.published ?? false;
  // `expiresOn` is optional on the read shape; fall through to the override
  // (caller may have just supplied it via `--expiration-date`). If neither
  // exists, send empty string — the real API will reject this with a clear
  // body-validation error rather than us forging a date.
  const expiresOn = overrides.expiresOn ?? current.expiresOn ?? "";
  return {
    expiresOn,
    introMessage: overrides.introMessage ?? current.introMessage,
    published,
    status,
    termsAndDisclaimers:
      overrides.termsAndDisclaimers ?? current.termsAndDisclaimers,
  };
}

export class QuotesApi {
  constructor(private client: Pax8Client) {}

  async list(params?: {
    page?: number;
    size?: number;
    companyId?: string;
    /**
     * Lowercase enum from `quoting-endpoints.json` → `GET /v2/quotes` →
     * `status` query param: `draft | assigned | sent | closed | declined |
     * accepted | changes_requested | expired | pending`. Threaded straight
     * through to the wire — previously the CLI filtered client-side because
     * this parameter was hidden. See #387.
     */
    status?: string;
  }): Promise<PaginatedResponse<Quote>> {
    const raw = await this.client.get<unknown>(
      "/quotes",
      params as Record<string, string | number | undefined>,
      V2,
    );
    return PaginatedQuoteSchema.parse(raw);
  }

  async get(id: string): Promise<Quote> {
    const raw = await this.client.get<unknown>(`/quotes/${id}`, undefined, V2);
    return QuoteSchema.parse(raw);
  }

  /**
   * Create an empty quote. Per the v2 spec (`POST /v2/quotes`), the body is
   * `{ clientId, quoteRequestId? }` and **line items are not accepted on
   * create** — they must be appended via `addLineItem` after the quote
   * exists. The CLI's `quotes create` orchestrates that two-call flow when
   * the user passes `--product`. See #311 and
   * `docs/triage/quotes-api-version.md` §9.1.
   */
  async create(data: CreateQuoteInput): Promise<Quote> {
    const raw = await this.client.post<unknown>("/quotes", data, V2);
    return QuoteSchema.parse(raw);
  }

  /**
   * Apply a partial set of overrides to a quote.
   *
   * The v2 spec requires all five mutable fields (`expiresOn`, `introMessage`,
   * `published`, `status`, `termsAndDisclaimers`) on every `PUT /v2/quotes/{id}` —
   * there is no partial PUT. `update()` therefore does a fetch-then-merge:
   * GET the current quote, project it + overrides into the full body, then
   * PUT. Callers see a partial-override interface and don't need to think
   * about the server-side contract. See #313.
   */
  async update(id: string, overrides: UpdateQuoteInput): Promise<Quote> {
    const current = await this.get(id);
    const body = buildFullUpdatePayload(current, overrides);
    const raw = await this.client.put<unknown>(`/quotes/${id}`, body, V2);
    return QuoteSchema.parse(raw);
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(`/quotes/${id}`, undefined, V2);
  }

  /**
   * Append a single line item to a draft quote.
   *
   * `POST /v2/quotes/{quoteId}/line-items` accepts an array of mixed-type
   * payloads (Standard / Custom / UsageBased). We post a single Standard
   * line and re-fetch the quote so callers always get the canonical post-
   * mutation state — the upstream response shape is `LineItemResponse[]`,
   * which doesn't include the surrounding quote-level fields callers care
   * about (totals, status).
   */
  async addLineItem(quoteId: string, input: AddQuoteLineItemInput): Promise<Quote> {
    // `effectiveDate` and `price` are required fields on
    // `AddStandardLineItemPayload` per the v2 quoting spec. See #312 and
    // `docs/triage/quotes-api-version.md` §9.1 — the CLI command resolves
    // sensible defaults (today, list price) before constructing this input.
    const payload = [
      {
        type: "Standard",
        productId: input.productId,
        quantity: input.quantity,
        ...(input.billingTerm ? { billingTerm: input.billingTerm } : {}),
        effectiveDate: input.effectiveDate,
        price: input.price,
        // `commitmentTermId` is the canonical v2 wire field on
        // `AddStandardLineItemPayload` (spec-confirmed against
        // `quoting-endpoints.json`). Only sent when the caller actually
        // supplied a UUID so we don't ship a `commitmentTermId: undefined`
        // key to the API for the (common) Monthly / no-commitment case.
        ...(input.commitmentTermId
          ? { commitmentTermId: input.commitmentTermId }
          : {}),
      },
    ];
    await this.client.post<unknown>(`/quotes/${quoteId}/line-items`, payload, V2);
    return this.get(quoteId);
  }

  /**
   * Remove a single line item from a quote.
   * `DELETE /v2/quotes/{quoteId}/line-items/{lineItemId}` returns 204.
   */
  async removeLineItem(quoteId: string, lineItemId: string): Promise<void> {
    await this.client.delete(`/quotes/${quoteId}/line-items/${lineItemId}`, undefined, V2);
  }

  /**
   * Transition a quote to a new status.
   *
   * The v2 spec defines no status-only endpoint — every status change rides
   * the same `PUT /v2/quotes/{quoteId}` as `update`, and requires the full
   * 5-field body. `setStatus` therefore also does a fetch-then-merge: GET
   * the current quote, override `status`, PUT the full body. See #314 and
   * `docs/triage/quotes-api-version.md` §9.1.
   *
   * Most commonly used as `setStatus(id, "sent")` — the trigger that publishes
   * the customer-facing quote and (server-side) emits the customer link/email.
   */
  async setStatus(id: string, status: QuoteStatusTransition): Promise<Quote> {
    return this.update(id, { status });
  }

  /** Convenience wrapper: `setStatus(id, "sent")`. */
  async send(id: string): Promise<Quote> {
    return this.setStatus(id, "sent");
  }
}
