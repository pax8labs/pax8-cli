---
"@pax8/cli": minor
"@pax8/core": minor
---

`pax8 quotes line-items add` and `pax8 quotes create` (shorthand path) now accept `--commitment-term <enum>` and `--commitment-term-id <uuid>`, mirroring the orders create pattern (`packages/cli/src/commands/orders/create.ts:350-351`). When `--commitment-term` is supplied, the CLI auto-resolves it to a commitment-term UUID against the partner's existing subscriptions for the product — same `resolveCommitmentTermId()` helper orders create uses. When `--commitment-term-id` is supplied directly, it wins over any `--commitment-term` (UUID short-circuits the lookup, matching orders create precedence). The resolved `commitmentTermId` rides through to `POST /v2/quotes/{quoteId}/line-items` as `AddStandardLineItemPayload.commitmentTermId` (spec-confirmed in `quoting-endpoints.json`).

Required for Microsoft NCE and other commitment-priced SKUs per QUOTE-311 (the `AddLineItemToQuoteCommandPayload.commitmentTermId` field), QUOTE-1283 (commitment persisted on the line item itself), QUOTE-406 (backfill of older NULL rows), and the NCE proration spike (Model A canonical — commitment is decided at quote-time and inherited by the resulting order).

`@pax8/core`: `AddQuoteLineItemInputSchema` gains `commitmentTermId: z.string().optional()` (mirrors `OrderLineItemInputSchema`'s shape — not strict `.uuid()` because demo fixtures use Pax8-style synthetic IDs). `QuoteLineItemSchema` gains `commitmentTerm: CommitmentSchema.nullable().optional()` for the read surface (`{ id, term }` per the v2 spec's `LineItemResponse.commitmentTerm`). The existing `CommitmentSchema` is reused rather than defining a new shape — its extra-optional `endDate` is harmless on the quote-line wire and reuse means future drift propagates to both consumers.

`pax8 quotes show` and `pax8 quotes line-items list` now render a "Commit" column on the line-item table (the term label, e.g. "1-Year"); `--json` consumers see the full `commitmentTerm: { id, term }` object. Mirrors how subscriptions render `commitment.term`.

Demo fixture: the Redwood E5 line on `quote-redwood-001` now carries `commitmentTerm: { id, term: "1-Year" }` so the render path exercises end-to-end under `PAX8_DEMO=1`.

The parity test from #426 (`packages/cli/src/__tests__/quotes-create-line-items-parity.test.ts`) was already structural — both new flags pass automatically. Belt-and-braces pin updated to enumerate them.

Follow-up to #429 (Candidate E in `docs/triage/v0.1.0-candidates.md`).
