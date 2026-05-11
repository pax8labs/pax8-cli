---
"@pax8/core": patch
"@pax8/cli": patch
---

Fix: `pax8 quotes line-items add` now sends the `effectiveDate` and `price` fields that the v2 `POST /v2/quotes/{quoteId}/line-items` Standard payload requires. Before this fix the call had the right URL (post-#316) but a 4xx-eliciting body — the v2 `AddStandardLineItemPayload` schema marks both fields required, and the CLI sent neither.

`effectiveDate` defaults to today (UTC), normalized to ISO 8601 (`YYYY-MM-DDT00:00:00Z`); `price` defaults to the product's list price (`suggestedRetailPrice`) for the chosen billing term, resolved via `products getPricing` and cached per command run. Both are overridable via new flags: `--effective-date <YYYY-MM-DD>` (strict format) and `--price <number>` (non-negative). The Standard payload is the only shape exposed — Custom and UsageBased remain out of scope (separate scope decision per #310).

Schema change: `AddQuoteLineItemInputSchema` in `@pax8/core` now requires `effectiveDate: z.string()` and `price: z.number()`. Downstream callers constructing `AddQuoteLineItemInput` directly must supply both.

Closes #312.
