---
"@pax8/cli": patch
---

Fix: `pax8 quotes create --expiration-date <date>` is no longer a silent no-op. The flag previously appeared in `quotes create --help` and even rendered "Expires: <date>" in the confirmation prompt, but the value was never sent to the API — `CreateQuoteInputSchema` has no `expiresOn` field, because `POST /v2/quotes` accepts only `{ clientId, quoteRequestId? }` per the v2 quoting OpenAPI spec (see `docs/triage/quotes-api-version.md` §9.1). Setting an expiration on a brand-new quote is a two-step flow on the real API.

Resolution (Option B from #306): the `--expiration-date` option has been removed from `pax8 quotes create`. The help footer now directs users at `pax8 quotes update <id> --expiration-date <YYYY-MM-DD>`, which has always wired the field through correctly via `UpdateQuoteInputSchema.expiresOn`. A regression test in `packages/cli/src/__tests__/quotes.create.test.ts` asserts the flag is absent from the create command's option list, so a future PR cannot silently re-introduce the no-op.

Scope: standalone fix. The larger v2 rewrite of `quotes create` (companyId → clientId, lineItems-on-create removal, quote-request orchestration) is tracked under #311 and not pre-empted here.
