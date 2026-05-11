# Quotes API version audit (v1 vs v2)

Read-only audit triggered by the domain-review reply prep for the Orders & Quotes section. Question being investigated: code comments and the domain review describe quote endpoints as `/v2/quotes/...`; do the wire calls actually hit `/v2` or do they resolve to `/v1`?

**TL;DR:** The CLI's wire calls resolve to `https://api.pax8.com/v1/quotes/...`. The public Pax8 API does **not** document any `/v1/quotes` surface — quotes live only at `/v2/quotes/...` per the `quoting-endpoints.json` spec (v2.0.0). The CLI's quote commands almost certainly 404 against the real API. Schemas, comments, and intent are all v2; the wire is v1 by accidental inheritance from the shared base URL. No test in the repo exercises a real wire URL, which is why the mismatch has not been observed.

This is reconciliation **case B** — CLI is on v1 by accident; comments and doc reflect intent; wire calls need to move to v2.

> **Addendum (§9, added after initial audit):** The wire-path fix is necessary but **not sufficient**. Deeper inspection of the v2 spec body schemas revealed that 5 of the 10 quote operations also need body-shape work to actually function against v2 — including field renames (`companyId` → `clientId`), a two-call orchestration for `create`, fetch-then-merge for PUT operations, and missing required fields on line-item POST. The original §1–§8 audit is preserved as written; §9 captures what the initial pass missed. The P0 hotfix (#307) is scoped to wire path only; the body-shape work is tracked under per-operation follow-up issues with the `quotes-v2-body-shape` label.

---

## 1. Resolved wire URLs for every QuotesApi method

`Pax8Client.buildUrl()` (`packages/core/src/api/client.ts:267-278`) is a simple concat: `new URL(baseUrl + normalizedPath)`. No middleware, no per-method base override, no v2 routing. The base URL is set once at construction time (`client.ts:53`) from `options.baseUrl ?? getDefaultBaseUrl()`. `getDefaultBaseUrl()` (`client.ts:37-41`) returns `https://api.pax8.com/v1` unless `PAX8_API_BASE` is set, and `FALLBACK_BASE_URL` (`client.ts:20`) is the hardcoded `https://api.pax8.com/v1`.

`PAX8_API_BASE` overrides the entire base URL including the version segment. It cannot be used to selectively move quote calls to v2 without breaking every non-quote call (companies, products, subscriptions, orders, invoices, contacts, usage — all legitimately under `/v1`).

Every relative path used by `QuotesApi` (`packages/core/src/api/quotes.ts`):

| Method | Source line | Path passed to client | Resolved URL (default base) |
|---|---|---|---|
| `list(params)` | `quotes.ts:26` | `GET /quotes` | `https://api.pax8.com/v1/quotes` |
| `get(id)` | `quotes.ts:31` | `GET /quotes/{id}` | `https://api.pax8.com/v1/quotes/{id}` |
| `create(data)` | `quotes.ts:36` | `POST /quotes` | `https://api.pax8.com/v1/quotes` |
| `update(id, data)` | `quotes.ts:41` | `PUT /quotes/{id}` | `https://api.pax8.com/v1/quotes/{id}` |
| `delete(id)` | `quotes.ts:46` | `DELETE /quotes/{id}` | `https://api.pax8.com/v1/quotes/{id}` |
| `addLineItem(quoteId, input)` | `quotes.ts:68` + re-fetch via `get()` | `POST /quotes/{quoteId}/line-items` | `https://api.pax8.com/v1/quotes/{quoteId}/line-items` |
| `removeLineItem(quoteId, lineItemId)` | `quotes.ts:77` | `DELETE /quotes/{quoteId}/line-items/{lineItemId}` | `https://api.pax8.com/v1/quotes/{quoteId}/line-items/{lineItemId}` |
| `setStatus(id, status)` | `quotes.ts:88` | `PUT /quotes/{id}` with body `{ status }` | `https://api.pax8.com/v1/quotes/{id}` |
| `send(id)` | `quotes.ts:93-95` | thin wrapper over `setStatus(id, "sent")` | same as above |

---

## 2. Public OpenAPI spec — what the API actually offers

Source: `https://devx.pax8.com/openapi` lists six specs. Two are relevant:

### `partner-endpoints.json`
- `servers[0]` base: `https://api.pax8.com/v1`
- **No quote endpoints exist** in this spec. Paths under `/v1` cover Companies, Products, Orders, Subscriptions, Contacts, Invoices, Usage Summaries.

### `quoting-endpoints.json` (spec `info.version` = `2.0.0`)
- `servers[0]` base: `https://api.pax8.com` (no version segment)
- All paths are prefixed with `/v2/`
- Quote-related paths defined:

| Method + path | Notes |
|---|---|
| `GET /v2/quotes` | List quotes |
| `POST /v2/quotes` | Create quote |
| `GET /v2/quotes/{quoteId}` | Get quote |
| `PUT /v2/quotes/{quoteId}` | Modify (used for status transitions too — needs verification, see follow-up P2) |
| `DELETE /v2/quotes/{quoteId}` | Delete quote |
| `POST /v2/quotes/{quoteId}/line-items` | Add line item(s) |
| `PUT /v2/quotes/{quoteId}/line-items` | Replace line items (CLI doesn't call this — uses top-level PUT) |
| `DELETE /v2/quotes/{quoteId}/line-items/{lineItemId}` | Remove single line item |
| `POST /v2/quotes/{quoteId}/line-items/bulk-delete` | Bulk delete (CLI doesn't expose) |
| `POST /v2/quotes/{quoteId}/take-ownership` | (CLI doesn't expose) |
| `GET/POST /v2/quotes/{quoteId}/access-list`, `DELETE .../{accessListEntryId}` | (CLI doesn't expose) |
| `GET/POST/PUT /v2/quotes/{quoteId}/attachments`, `POST .../shared`, `GET/DELETE .../{attachmentId}` | (CLI doesn't expose) |
| `GET/POST/PUT /v2/quotes/{quoteId}/sections` | (CLI doesn't expose) |
| `GET/PUT /v2/quote-preferences`, `POST .../attachments`, `DELETE .../attachments/{attachmentId}` | (CLI doesn't expose) |
| `GET/POST/PUT /v2/quote-attachments`, `POST .../shared`, `DELETE/GET/PATCH .../{attachmentId}` | (CLI doesn't expose) |

**Result:** The public API has no `/v1/quotes` endpoint. The path the CLI hits (`/v1/quotes/...`) is undocumented and almost certainly returns 404.

---

## 3. Zod schemas — v1, v2, or hybrid?

Schemas are uniformly modeled on v2. Evidence:

- `QuoteSchema` (`packages/core/src/api/types.ts:451-475`) uses the v2 field names `createdOn`, `expiresOn` (renamed from `createdDate`/`expirationDate` per the comment at `types.ts:454-458`, citing #273/#8). Workflow fields `acceptedBy`, `declinedBy`, `respondedOn`, `revokedOn`, `publishedOn`, `published`, `referenceCode`, `salesMarginPercentage`, `intentType` are all called out in the schema preamble (`types.ts:438-450`) as "fields the public quoting v2 endpoint returns".
- `QuoteLineItemSchema` (`types.ts:410-424`) — comment at line 413-416 explicitly attributes the optional `id` field to "the v2 endpoints (`POST /v2/quotes/{id}/line-items`, `DELETE .../line-items/{lineItemId}`)" requiring per-line addressability.
- `CreateQuoteInputSchema` (`types.ts:592-600`) — no explicit version label but shape matches v2 (`companyId` + `lineItems[]` with `productId`/`quantity`/`billingTerm`/`provisioningDetails`).
- `AddQuoteLineItemInputSchema` (`types.ts:621-625`) — preamble comment at line 614-620 explicitly labels it "Input for `POST /v2/quotes/{quoteId}/line-items`".
- `QuoteStatusTransitionSchema` (`types.ts:632-643`) — preamble at line 628-631 labels it "Body for `PUT /v2/quotes/{quoteId}` when transitioning a quote to `sent`".

Demo data (`packages/core/src/mock/demo-data.ts:194-196,201-225`) is built to match v2 shapes. No v1 quote shape exists anywhere in the codebase.

There is no hybrid — the schemas are clean v2, the comments are clean v2, the only thing on v1 is the wire URL.

---

## 4. Test coverage — do any tests exercise real wire calls?

No. Every quote-related test either mocks the API client or runs in demo mode:

- `packages/core/src/api/quotes.test.ts` — mocks `Pax8Client.get/post/put/delete` with `vi.fn()` (`quotes.test.ts:8-17`). Assertions are on the **relative path strings** the methods pass to the client (e.g. `expect(client.get).toHaveBeenCalledWith("/quotes/${QUOTE_ID}")` at line 60). `buildUrl()` is never invoked. `fetch()` is never invoked. The `/v1` segment of the resolved URL is invisible to these tests.
- `packages/cli/src/__tests__/quotes.line-items.test.ts:133` and `quotes.send.test.ts:76` — subprocess tests spawn the built CLI with `PAX8_DEMO=1`, which swaps in `MockPax8Client`. No wire calls of any kind.
- No integration test against a sandbox or live API exists in the repo (`grep -rn "fetch\|http://\|https://" packages/cli/src/__tests__/quotes*` returns only env-var lines).

This is why the mismatch has never been observed: every layer of the test pyramid is below the wire.

---

## 5. Reconciliation: which case (A–E)?

**Case B** — CLI is on v1 by accident; comments, schemas, and doc reflect intent (v2); wire calls should be on v2.

The accident is structural rather than typo-level. The `Pax8Client` base URL bakes in `/v1` as a project-wide convention because every other resource (companies, products, subscriptions, orders, invoices, contacts, usage) does live at `/v1`. The quoting API is the only Pax8 partner surface that lives at `/v2`, and the `QuotesApi` methods inherit the shared `/v1` base by writing relative paths like `/quotes/{id}` rather than absolute or version-explicit paths. Nothing in the type system or test suite enforces version-correctness per resource.

Cases A (deliberate v1), C (silent wire mismatch with working v1 endpoints), and D (v1/v2 functionally identical) are ruled out by §2: there is no `/v1/quotes` surface in the public spec. Case E (override I missed) is ruled out by §1: `buildUrl()` is a plain concat with no per-resource routing.

---

## 6. What needs to change

**CLI code only.** Comments, schemas, and the domain-review doc are already correct.

Three possible code-level fixes, in increasing scope:

1. **Quick fix — version-prefixed quote paths.** Make `QuotesApi` build URLs that override the `/v1` base segment. Either prefix every quote path with `/v2` and strip the inherited `/v1` (requires `Pax8Client` to expose a "use this absolute path" option), or pass absolute URLs to `client.request()` directly. Smallest surface change; survives until another v2-only resource is added.

2. **Structural fix — version-per-resource.** Refactor `Pax8Client` so the base URL is `https://api.pax8.com` (no version) and every API method names its own version prefix when calling `client.get/post/...`. `QuotesApi` paths become `/v2/quotes/...`; every other API class becomes `/v1/companies/...`, `/v1/products/...`, etc. This is the long-term shape and matches how the public OpenAPI specs are split (one v2 spec for quoting, one v1 spec for everything else).

3. **Out-of-scope but worth flagging — sandbox integration test.** Even after a code fix, the lack of wire-level testing means the next version-routing regression is again invisible. A minimal smoke test that hits the real sandbox for one read-only endpoint per resource would have caught this.

---

## 7. Follow-up issues to file

Recommend filing as separate GitHub issues, in this order:

1. **fix(quotes): wire calls resolve to `/v1/quotes/...` which does not exist; should be `/v2/quotes/...`** — P0. The bug itself. Pick fix option 1 or 2 above. Cite this triage doc.

2. **test(quotes): add sandbox integration test that exercises a real wire URL** — P1. Even one read-only smoke test (e.g. `pax8 quotes list` against sandbox) would have caught the regression. Block on credential availability if needed.

3. **verify: `PUT /v2/quotes/{quoteId}` accepts a status-only body** — P2. The CLI's `setStatus`/`send` (`quotes.ts:87-95`) posts `{ status: "sent" }` to the PUT endpoint, which the v2 spec lists as "Modify existing quote details". The spec body schema wasn't captured in this audit; confirm the API accepts status-only PUT before assuming `send` will work end-to-end after the wire fix.

4. **coverage: v2 quote surface beyond the current CLI scope** — P3 / informational. The v2 spec includes `take-ownership`, `bulk-delete`, sections, attachments, access-list, quote-preferences. Out of scope for the wire fix; useful to track as a coverage backlog after the domain review settles. This is the same kind of "CLI is partner-facing and intentionally scopes a subset" decision the issue from Fred's `intentType` finding raised — same scope-doc pattern applies.

---

## 8. Constraints honored

- Read-only audit: no CLI code, schemas, or existing doc text modified. This triage doc is the only file written.
- No sandbox API calls attempted (would require credentials per the user constraint).
- All claims cite file paths + line numbers (CLI code) or spec URL + path (public OpenAPI).

---

## 9. Addendum: body-shape findings (added after the initial audit)

After the wire-path investigation closed with "case B — CLI is on v1 by accident; schemas and comments are correct," a follow-up pass against the v2 spec's `requestBody` schemas revealed that **the wire-path fix is necessary but not sufficient**. The initial audit verified that `QuoteSchema` mirrors the v2 *response* shape; it did not verify that the CLI's *request* shapes (`CreateQuoteInputSchema`, `UpdateQuoteInputSchema`, `AddQuoteLineItemInputSchema`, plus the payloads constructed at call sites) match what the v2 endpoints actually accept.

Five of the ten quote operations need body-shape work in addition to the wire-path fix. The body schemas below were verified by fetching the relevant `requestBody` from `https://devx.pax8.com/openapi/quoting-endpoints.json`.

### 9.1 Per-operation body-shape mismatches

| Operation | CLI sends today | v2 spec accepts | Mismatch class | Status |
|---|---|---|---|---|
| `POST /v2/quotes` (create) | `{ clientId, quoteRequestId? }` | `{ clientId }` (required) + `quoteRequestId` (optional). **No `lineItems` on create.** | Field rename (`companyId` → `clientId`) + structural (line items must be added via a separate `POST /v2/quotes/{id}/line-items` after create) | **Resolved in #311.** `CreateQuoteInputSchema` is now `{ clientId, quoteRequestId? }`; the `quotes create` command orchestrates the two-call shorthand when `--product` is passed, and creates an empty draft quote otherwise (closing the shorthand-vs-canonical decision from #305). Partial-failure path surfaces the created quote ID + a recovery hint pointing at `quotes line-items add`. |
| `PUT /v2/quotes/{id}` (update) | `{ lineItems?, expiresOn? }` | All five required: `{ expiresOn, introMessage, published, status, termsAndDisclaimers }` | Field-only PUT rejected — need fetch-then-merge. For line-item replacement, use `PUT /v2/quotes/{id}/line-items` instead. | **Resolved in #313 (bundled with #314).** `QuotesApi.update` now does fetch-then-merge via a shared `buildFullUpdatePayload` helper — every PUT carries the full 5-field body the v2 spec requires. `--expiration-date YYYY-MM-DD` is normalized to ISO 8601 date-time (`normalizeIsoDate`) before sending. Line-item replacement (`--product`) decomposes into per-line `DELETE` + a fresh `POST /v2/quotes/{id}/line-items` rather than going through the top-level PUT; partial-failure between the delete and the add is surfaced with a `quotes line-items add` recovery hint mirroring `quotes create`'s pattern (#311). `UpdateQuoteInputSchema` is now `{ expiresOn?, introMessage?, published?, status?, termsAndDisclaimers? }` (all optional partial overrides); `lineItems` is removed entirely from the update input. |
| `PUT /v2/quotes/{id}` (setStatus / send) | `{ status }` | Same five required — no separate status-transition endpoint exists in the spec | Same as `update`: fetch-then-merge | **Resolved in #314 (bundled with #313).** `QuotesApi.setStatus` delegates to `update({ status })` so status flips ride the same fetch-then-merge path as every other PUT. `send` remains a thin wrapper over `setStatus(id, "sent")`. |
| `POST /v2/quotes/{id}/line-items` (addLineItem) | `[{ type: "Standard", productId, quantity, billingTerm?, effectiveDate, price }]` | For Standard: `{ type, productId, quantity, billingTerm, effectiveDate, price }` | Missing required fields | **Resolved in #312.** `effectiveDate` defaults to today (UTC); `price` resolves from the product's list price (`suggestedRetailPrice`) for the chosen billing term. `--effective-date` and `--price` flags expose overrides. |

The five read paths (`list`, `get`, `delete`, `removeLineItem`, `line-items list` via re-fetch) only need the wire-path fix (resolved in #316).

### 9.2 Response schema gaps

`QuoteSchema` (`packages/core/src/api/types.ts`) does not model several fields the v2 spec marks as required on `GET /v2/quotes/{quoteId}`:

- ~~`introMessage` (string)~~ — **modeled as of #313/#314.** Required on the read shape; fetch-then-merge in `update` / `setStatus` round-trips it back to the API.
- ~~`termsAndDisclaimers` (string)~~ — **modeled as of #313/#314.** Same lifecycle as `introMessage`.
- `client` (ClientDetails)
- `partner` (PartnerDetails)
- `ownedBy` (UserModel)
- `attachments` (array)
- `totals` (InvoiceTotals)
- `createdBy`, `createdByEmail` (strings)

Zod's default non-strict mode strips the remaining unmodeled fields silently today, so they don't surface as parse errors. The two fields needed for fetch-then-merge are now modeled; the rest stay deferred until a CLI surface needs them.

### 9.3 What this means for #307

The P0 hotfix is intentionally scoped to wire path **only**. After it lands:

- The 5 read operations work end-to-end against the real v2 API.
- The 5 write operations move from **404 not-found** (current state — wrong URL) to **4xx body-shape errors** (intended post-#307 state — right URL, wrong body). This is the staging point for the per-operation body-shape follow-ups, which are tracked under the `quotes-v2-body-shape` label and held until #308's integration test pattern exists.

Going beyond wire-path-only in #307 would mean blind body-shape work without a wire-level safety net — repeating the audit pattern that got us here.

---

## 10. Audit retrospective: why the body-shape problems went unnoticed

The initial audit (§1–§8) answered the URL question correctly. What it missed is that "the schemas are v2" and "the CLI sends v2-shaped requests" are different claims, and only the first was verified. Three causes worth carrying into future audits:

1. **URL audit and body audit are separate verification tracks.** The investigation prompt centered on URL paths, and the audit followed that framing — `servers`, `paths`, version prefixes. Request bodies were never inspected against what the CLI actually POSTs/PUTs. For any future "does our client match the spec?" audit, treat URLs and bodies as two independent passes; finishing one is not finishing the other.

2. **Code comments are hypotheses, not evidence.** `quotes.ts` and `types.ts` have ~12 comments asserting v2 alignment (e.g. line 615: "Input for `POST /v2/quotes/{quoteId}/line-items`"). §3 of the original audit took these as confirmation. They describe *intended* v2 alignment, not *verified* v2 alignment — `CreateQuoteInputSchema` is labeled as v2 but uses `companyId` (a v1 conceptual name) and includes `lineItems` which v2 doesn't accept on create. Treat schema-aligning comments as claims to verify against the spec, not as evidence the alignment is real.

3. **Response-shape alignment masquerades as full alignment.** `QuoteSchema` does mirror the v2 response shape, and §3 reported this correctly. But input schemas (`CreateQuoteInputSchema`, `UpdateQuoteInputSchema`, `AddQuoteLineItemInputSchema`) are independently authored and were never the same audit object as the response schema. Lesson: input and output schemas need separate verification — even when they describe "the same resource."

**Meta-finding:** every layer of this audit was paper-only — code comments, Zod schemas, OpenAPI spec text. A single real `POST /v2/quotes` call against sandbox would have surfaced both the URL bug and the body-shape bugs. The structural test gap (#308) is also the structural audit gap; future audits should treat "no test exercises the real wire" as a flag that paper-only conclusions may be incomplete.

---

## 11. Correction to §6

§6 originally concluded: *"CLI code only. Comments, schemas, and the domain-review doc are already correct."*

That conclusion holds for **URL routing** (the question the audit asked) but is wrong for **request bodies** (the question the audit didn't ask). The input schemas need updates in concert with the body-shape follow-ups — see §9.1 and §9.2. The domain-review doc also needs updating to honestly frame quote writes as "tracked under [issues] and landing before publish" rather than "working v2 surface."
