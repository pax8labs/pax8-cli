---
"@pax8/core": patch
"@pax8/cli": patch
---

Fix: `pax8 quotes update` and `pax8 quotes send` now send the v2-spec body shape on `PUT /v2/quotes/{id}`. Per the public quoting OpenAPI spec (v2.0.0), every PUT on that endpoint requires all five mutable fields (`expiresOn`, `introMessage`, `published`, `status`, `termsAndDisclaimers`) — there is no partial PUT and no separate status-transition endpoint. The previous bodies (`{ lineItems?, expiresOn? }` for `update`; `{ status }` for `send`/`setStatus`) would have produced 4xx body-shape errors against the real API (#313, #314; see `docs/triage/quotes-api-version.md` §9.1).

Behavior changes:

- `QuotesApi.update(id, overrides)` now does fetch-then-merge internally: it GETs the current quote, projects (current + overrides) through a shared `buildFullUpdatePayload` helper, then PUTs the full 5-field body. Callers see a partial-override interface (`{ expiresOn?, introMessage?, published?, status?, termsAndDisclaimers? }`) and don't need to think about the server-side contract.
- `QuotesApi.setStatus(id, status)` and `QuotesApi.send(id)` ride the same fetch-then-merge path — status transitions go through `update({ status })`, not a status-only PUT body.
- `UpdateQuoteInputSchema` is rewritten: `lineItems` is removed entirely (the v2 PUT does not accept it); `expiresOn`, `introMessage`, `published`, `status`, and `termsAndDisclaimers` are added as optional overrides.
- `QuoteSchema` adds `introMessage` and `termsAndDisclaimers` as required strings — both must round-trip through the read shape so fetch-then-merge can preserve them on writes.
- `pax8 quotes update --expiration-date YYYY-MM-DD` now normalizes the user-friendly date to ISO 8601 midnight-UTC (`YYYY-MM-DDT00:00:00Z`) before sending, matching the v2 spec's `date-time` typing. A new shared `normalizeIsoDate(raw, flagName)` helper is factored out from the existing `resolveEffectiveDate` so both `--expiration-date` and `--effective-date` get the same parse-and-validate behavior with flag-specific error messages.
- `pax8 quotes update --product` no longer relies on the top-level PUT to replace line items (the v2 surface doesn't accept it). The CLI decomposes the request into per-line `DELETE /v2/quotes/{id}/line-items/{lineItemId}` calls for existing items plus a fresh `POST /v2/quotes/{id}/line-items` for the new one — reusing the `resolveListPrice` / `resolveEffectiveDate` helpers that `quotes create` and `quotes line-items add` already share. Partial-failure between the delete and the add is surfaced with a clear `pax8 quotes line-items add ...` recovery hint, mirroring the pattern from `quotes create` (#311).

Out of scope: `--intro-message` / `--terms-and-disclaimers` / `--status` are not exposed as CLI flags — those fields aren't user-settable today, and the fetch-then-merge preserves the server-side values transparently. Exposing them is a separate enhancement.

Closes #313 and #314. The remaining body-shape audit row (`POST /v2/quotes/{id}/line-items` add, #312) was resolved earlier; with this patch the entire `quotes-v2-body-shape` label is empty.
