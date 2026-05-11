---
"@pax8/core": patch
"@pax8/cli": patch
---

Fix: `pax8 quotes create` now sends the v2-spec body shape (`{ clientId, quoteRequestId? }`) instead of the pre-v2 `{ companyId, lineItems[] }`. Per the public quoting OpenAPI spec (v2.0.0), `POST /v2/quotes` accepts only `clientId` (required) plus an optional `quoteRequestId` — line items are added through a separate `POST /v2/quotes/{quoteId}/line-items` call after the quote exists. The previous body would have produced a 4xx body-shape error against the real API (#311; see `docs/triage/quotes-api-version.md` §9.1).

Behavior changes:

- `--product` is now **optional** on `quotes create`. Without it, the command creates an empty draft quote (the natural shape for the v2 surface). This closes the shorthand-vs-canonical decision from #305 — empty quote is the canonical path, two-call shorthand is a convenience for the common single-line case.
- When `--product` is supplied, the command orchestrates two wire calls: `POST /v2/quotes` to create the empty quote, then `POST /v2/quotes/{id}/line-items` to append the line. If the line-item POST fails after the create succeeds, the new quote ID is surfaced prominently with a recovery hint (`pax8 quotes line-items add <id> --product X --quantity N`) so the user can retry the add manually instead of losing the quote.
- `CreateQuoteInputSchema` is renamed: `companyId` → `clientId`. The `lineItems` array is removed from the create input entirely.

Scope: `quotes create` only. The remaining body-shape issues on `quotes update` (#313), `quotes send` (#314), and `quotes line-items add` (#312) are tracked separately under the `quotes-v2-body-shape` label.
