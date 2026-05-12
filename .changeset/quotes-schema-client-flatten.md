---
"@pax8/core": patch
---

Align the `QuoteSchema` Zod parser with the v2 quoting API's nested `client` object so `pax8 quotes list` / `quotes show` return a usable `companyId` against the real API. Closes #384 (block-launch finding from `docs/triage/partner-readiness-audit/01-api-conformity-reads.md`).

Pre-fix, `GET /v2/quotes` returned `{ client: { id, isShadowCompany, name } }` per `quoting-endpoints.json → components.schemas.QuoteResponse`, but `QuoteSchema` expected a flat `companyId: z.string()`. Zod's default behavior dropped the unknown `client` key, leaving `companyId` undefined on every parsed row when run against the real API. Demo mode masked this because the demo `Quote` fixture carried a flat `companyId` directly.

`QuoteSchema` now `preprocess`es the wire payload to flatten `client.id → companyId` and surfaces `client.name` / `client.isShadowCompany` as flat optional `clientName` / `clientIsShadow` aliases. Demo data (`packages/core/src/mock/demo-data.ts`) now emits the spec's nested `client: {...}` shape and the `MockPax8Client` routes quote reads through `QuoteSchema.parse` — so the demo path exercises the same flattening as the real wire and demo mode stops masking the bug. The legacy flat shape (used by the `QuotesApi` unit-test fixtures) still parses cleanly because the preprocess passes through unchanged when no nested `client` is present.
