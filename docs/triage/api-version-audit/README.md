# API-version audit — CLI write operations

Read-only audit triggered by the Quotes finding (`docs/triage/quotes-api-version.md`): CLI quote commands hit `/v1/quotes/...` while the public OpenAPI documents quotes only at `/v2/quotes/...`, AND several quote writes send body shapes that don't match the spec's `requestBody`. The original quotes audit initially missed the body-shape problems because it only verified URLs. This audit is the follow-up sweep across every other write-heavy CLI surface, with both URL and body checks done independently — per the lesson logged in §10 of the quotes triage.

**Scope:** writes only (create / update / delete / cancel / status transitions / anything that sends a request body). Reads, quotes, computed surfaces (renewals, audit, recommendations, report mrr, cost sim), and the recommendations engine are out of scope.

**Per-domain reports:** [subscriptions.md](subscriptions.md), [orders.md](orders.md), [companies.md](companies.md), [contacts.md](contacts.md), [webhooks.md](webhooks.md), [invoices.md](invoices.md).

---

## 1. Totals

**15 write operations audited across 6 domains.** Of those, 14 make an HTTP write call; 1 (`invoices dispute`) is draft-only by design and makes no wire write — see §4 (case F).

Counting against the 14 wire-write operations:

| Bucket | Count | Operations |
|---|---|---|
| **Wire-clean and body-clean** | 1 | `subscriptions update` |
| **Wire-clean, minor body/query-format deviation** | 1 | `subscriptions cancel` (`cancelDate` date-only vs spec's `format: date-time`) |
| **Wire-clean, body broken** | 2 | `orders create`, `companies create` |
| **Wire broken, body clean (or no body)** | 6 | `contacts delete`, `webhooks update`, `webhooks enable`, `webhooks disable`, `webhooks delete`, `webhooks logs retry` |
| **Wire broken AND body broken** | 4 | `companies update` (verb is PUT, spec is PATCH; address shape latent), `contacts create`, `contacts update`, `webhooks create` |

Counted on each dimension independently:

- **Wire issues (URL, prefix, or HTTP verb wrong):** 10 / 14 operations (71%).
- **Body-shape issues (missing required, extra fields, wrong type, wrong name):** 7 / 14 operations (50%), plus 1 latent (companies update — address fields don't surface yet because no address flags are wired into `companies update`).
- **Truly clean on both axes:** 1 / 14 (`subscriptions update`).

Two distinct wire-bug classes were found:

1. **Base-URL split.** The Pax8 webhooks API lives at `https://api.pax8.com/api/v2/...` per `webhooks-api.json servers[0].url`, but `Pax8Client` is hard-pinned to `FALLBACK_BASE_URL = "https://api.pax8.com/v1"` (`packages/core/src/api/client.ts:20`). Every webhook write resolves to `/v1/webhooks/...` instead of `/api/v2/webhooks/...`. Same shape as the quotes `/v1` vs `/v2` bug, with a different (more unusual) prefix.
2. **Path-nesting mismatch.** The spec only documents contacts under `/companies/{companyId}/contacts[/{contactId}]`. The CLI hits flat `/contacts/{id}` paths that **do not exist in the spec at all** — verified via `jq '.paths | keys[] | select(test("contact"; "i"))' /tmp/partner-endpoints.json` returning only the nested forms.

And one verb-level bug: `companies update` issues PUT, but `partner-endpoints.json paths."/companies/{companyId}"` declares only `get` and `patch` (no PUT).

---

## 2. Per-operation verdict table

| # | Domain | Operation | Wire | Body | Verdict | Recommendation |
|---|---|---|---|---|---|---|
| 1 | subscriptions | `update` (`PUT /v1/subscriptions/{id}`) | ✅ | ✅ | **A — clean** | none |
| 2 | subscriptions | `cancel` (`DELETE /v1/subscriptions/{id}?cancelDate=...`) | ✅ | minor B' | **B' (minor)** — spec types `cancelDate` as `format: date-time`, CLI sends date-only | confirm with marketplace API team; align spec or CLI |
| 3 | orders | `create` (`POST /v1/orders`) | ✅ | ❌ | **B'** — missing required `lineItemNumber`; latent `provisioningDetails` shape mismatch | populate `lineItemNumber` (1-based index); fix `OrderLineItemInputSchema.provisioningDetails` to `Array<{key, values[]}>` before any feature uses it |
| 4 | companies | `create` (`POST /v1/companies`) | ✅ | ❌ | **B'** — `address.state`/`address.zip` instead of `stateOrProvince`/`postalCode`; 3 required booleans (`billOnBehalfOfEnabled`, `selfServiceAllowed`, `orderApprovalRequired`) never sent; always-present empty `address` object | rename address fields in `AddressSchema`; stop sending empty `address`; add flags (or explicit defaults) for the 3 required booleans |
| 5 | companies | `update` (`PUT /v1/companies/{id}`) | ❌ (verb) | latent ❌ | **B + B'** — CLI uses PUT, spec is **PATCH-only**; address-field-name mismatch is latent (no address flags on update today) | change `CompaniesApi.update` from `client.put` → `client.patch`; partial body is then correct; also fix `AddressSchema` names |
| 6 | contacts | `create` (`POST /v1/contacts`) | ❌ | ❌ | **wire + body** — flat path doesn't exist in spec (spec: `POST /v1/companies/{companyId}/contacts`); body carries `companyId` (not in spec body); `types` is `string[]` but spec wants `Array<{type, primary}>`; `phone` optional in CLI but spec marks required | thread `companyId` into the URL path; drop `companyId` from body; reshape `types`; make `--phone` required |
| 7 | contacts | `update` (`PUT /v1/contacts/{id}`) | ❌ | ❌ | **wire + body** — flat path doesn't exist in spec; spec PUT body requires `firstName, lastName, email, phone` but CLI sends partial without fetch-then-merge; `types` shape wrong | thread `companyId` into URL; fetch-then-merge using the `get(id)` result the handler already fetches; reshape `types` |
| 8 | contacts | `delete` (`DELETE /v1/contacts/{id}`) | ❌ | n/a | **wire-only** — flat path doesn't exist in spec (`DELETE /v1/companies/{companyId}/contacts/{contactId}`); pre-delete `get(id)` already returns `companyId` to thread | thread `companyId` into URL |
| 9 | webhooks | `create` (`POST /v1/webhooks`) | ❌ (base) | ❌ | **wire + body** — `/v1` vs spec's `/api/v2`; missing required `displayName`; CLI sends `topics: string[]` but spec wants `webhookTopics: Array<{topic, filters}>` | fix base URL (see §3); add `--display-name`; restructure topic input; surface optional flags |
| 10 | webhooks | `update` (`POST /v1/webhooks/{id}/configuration`) | ❌ (base) | ✅ | **wire-only** — `/v1` vs `/api/v2`; sub-resource path is correct | fix base URL only |
| 11 | webhooks | `enable` (`POST /v1/webhooks/{id}/status`, body `{active:true}`) | ❌ (base) | ✅ | **wire-only** — `/v1` vs `/api/v2` | fix base URL only |
| 12 | webhooks | `disable` (same path, `{active:false}`) | ❌ (base) | ✅ | **wire-only** — `/v1` vs `/api/v2` | fix base URL only |
| 13 | webhooks | `delete` (`DELETE /v1/webhooks/{id}`) | ❌ (base) | n/a | **wire-only** — `/v1` vs `/api/v2` | fix base URL only |
| 14 | webhooks | `logs retry` (`POST /v1/webhooks/{webhookId}/logs/{logId}/retry`) | ❌ (base) | ✅ | **wire-only** — `/v1` vs `/api/v2` | fix base URL only |
| 15 | invoices | `dispute` | n/a | n/a | **case F** — no wire call by design; writes a local draft + portal template; spec exposes no dispute endpoint | flag as deliberate divergence; no code change |

---

## 3. Prioritized follow-up issues

Recommend filing as separate GitHub issues. Ordered by blast radius × user impact.

**P0 — broken at the wire today (likely 404 on real API):**

1. **fix(webhooks): all writes hit `/v1/webhooks/...` but spec lives at `/api/v2/webhooks/...`.** Affects 6 write ops + every webhook read. Same class as the quotes `/v1` vs `/v2` bug. **Cannot** be fixed by changing `Pax8Client`'s single `baseUrl` — every non-webhooks API (companies, subscriptions, orders, invoices, contacts, products, usage) genuinely lives at `/v1`. Needs per-API base override or per-call absolute URL support in `Pax8Client`. See `docs/triage/api-version-audit/webhooks.md §"Sub-resource routing observations"`. Also delete dead helpers `WebhooksApi.update` (`PUT /webhooks/{id}` — not in spec) and `WebhooksApi.updateStatus` (`PATCH /webhooks/{id}` — not in spec) at `packages/core/src/api/webhooks.ts:36-44`.

2. **fix(contacts): CLI uses flat `/v1/contacts/*` paths, spec only documents nested `/v1/companies/{companyId}/contacts/*`.** Affects 3 ops (create / update / delete). Thread `companyId` into `ContactsApi.create/update/delete`; for `update` and `delete` the company id is already obtainable from the pre-write `get(id)` response (the read schema includes `companyId`). See `contacts.md`.

3. **fix(webhooks/create): missing required `displayName`; `topics: string[]` should be `webhookTopics: Array<{topic, filters}>`.** Required-field violation per `webhooks-api.json components.schemas.CreateWebhook.required`. Pair with the base-URL fix in #1. See `webhooks.md §"Operation: webhooks create"`.

**P1 — wire-correct but body wrong; would 4xx today against a strict implementation:**

4. **fix(contacts/create): `types: string[]` should be `Array<{type, primary}>`; `companyId` belongs in the path, not the body; `--phone` should be required.** Per `partner-endpoints.json components.schemas.Contact` (required: `firstName, lastName, email, phone`) and `components.schemas.ContactType` (object with `type` and `primary`). See `contacts.md`.

5. **fix(contacts/update): partial PUT body doesn't satisfy spec's `Contact` required-field set; no fetch-then-merge.** The handler at `packages/cli/src/commands/contacts/update.ts:94` already calls `get(id)` for the preview but never merges the result into the outgoing body. Same `types` shape fix as #4. See `contacts.md`.

6. **fix(companies/create): address field names + missing required booleans.** `AddressSchema` uses `state`/`zip` (`packages/core/src/api/types.ts:56-62`) but spec is `stateOrProvince`/`postalCode`. Three required booleans (`billOnBehalfOfEnabled`, `selfServiceAllowed`, `orderApprovalRequired`) are omitted entirely. CLI also always sends an empty `address` object even when no flags are passed. See `companies.md`.

7. **fix(companies/update): wrong HTTP method (PUT vs PATCH).** `CompaniesApi.update` at `packages/core/src/api/companies.ts:34-37` issues `client.put`; spec documents only `PATCH /companies/{companyId}`. `Pax8Client.patch` already exists. Partial-body approach is correct *for PATCH* — only the verb needs to change. See `companies.md`.

8. **fix(orders/create): missing required `lineItemNumber`; latent `provisioningDetails` shape mismatch.** Spec's `CreateLineItem.required` includes `lineItemNumber` (a writeOnly number used for parent/child line-item references). CLI never sends it. Separately, `OrderLineItemInputSchema.provisioningDetails` is typed as `Record<string, unknown>` (`packages/core/src/api/types.ts:224`) but the spec requires `Array<{key, values[]}>` — latent today because `orders create` never populates it, but a foot-gun for any future feature that wires through provisioning. See `orders.md`.

**P2 — minor / unverified:**

9. **verify(subscriptions/cancel): `cancelDate` query-param format.** Spec types `cancelDate` as `format: date-time` with offset example; CLI emits `YYYY-MM-DD` and the source comment at `packages/cli/src/commands/subscriptions/cancel.ts:44-45` explicitly asserts the API "treats `cancelDate` as a date (not a timestamp)." Two readings (spec wrong vs CLI wrong) — confirm with marketplace API team via sandbox.

10. **verify(orders/create): three spec ambiguities.** (a) `CreateLineItem.required` lists `companyId` but the schema declares no such property and the canonical example omits it — almost certainly a spec bug. (b) The example uses `commitmentTermID` (capital ID) where the schema uses `commitmentTermId`. (c) `lineItemNumber` required by schema, absent from example. Confirm with Pax8 before patching. See `orders.md §"Spec ambiguities"`.

**P3 — cleanup / coverage debt:**

11. **chore(core): delete dead webhooks helpers and their input schemas.** `WebhooksApi.update`, `WebhooksApi.updateStatus`, `UpdateWebhookInputSchema` (`packages/core/src/api/types.ts:516-521`). They target endpoints the spec does not document and would 404 (or worse, hit a legacy alias) for any embedded `@pax8/core` consumer that picks them up. See `webhooks.md §"Sub-resource routing observations"`.

12. **note(read-side): out-of-scope but worth tracking — `CompanySchema` and the contacts `types` shape also affect reads.** `packages/core/src/api/types.ts:56-62` has the same wrong `state`/`zip` field names on the read schema, so the CLI is likely silently dropping those fields when displaying companies today (Zod's non-strict mode strips). Same for contacts `types` on read. Not in this audit's scope but the schema fixes from P1 #4 and #6 should land together with the read-side fix.

13. **coverage: webhooks topic sub-resources.** Spec defines `POST/PUT /webhooks/{id}/topics`, `DELETE /webhooks/{id}/topics/{topicId}`, `PUT /webhooks/{id}/topics/{topicId}/configuration`, `POST /webhooks/{id}/topics/{topic}/test`. CLI exposes none. Out of scope for "fix what exists," tracked as backlog.

14. **doc(invoices/dispute): flag case F in user-facing audit summary.** `pax8 invoices dispute` honestly presents itself as a local draft generator, but consumers of this audit pack shouldn't have to re-derive that "invoices write" means "local file write." See `invoices.md`.

---

## 4. Reconciliation cases used

Extending the quotes audit's case set (A–E) with two new cases this audit needed:

- **A — deliberate-and-correct.** Wire URL, HTTP method, body shape, and required-field coverage all match the spec. Example: `subscriptions update`.
- **B — wire-bug-by-accident.** Wrong base URL, wrong path prefix, wrong path nesting, or wrong HTTP verb. The CLI's intent matches the spec but the call doesn't resolve to the documented endpoint. Examples: `companies update` (PUT vs PATCH), `contacts create/update/delete` (flat vs nested), all webhook writes (`/v1` vs `/api/v2`).
- **B' — body-shape-only deviation** (new label; introduced in the quotes addendum). Wire URL correct, body diverges from `requestBody.content."application/json".schema`: missing required fields, extra fields, wrong type, wrong key name, wrong nesting. Examples: `orders create` (missing `lineItemNumber`), `companies create` (address field names + missing booleans), `subscriptions cancel` (`cancelDate` format).
- **B + B'** — both. Wire and body both diverge. Examples: `companies update`, `contacts create`, `contacts update`, `webhooks create`.
- **C — silent wire mismatch.** CLI on wrong wire path but the path coincidentally works because of legacy aliasing or back-compat routing. Not confirmed for any operation in this audit (would require sandbox verification), but flagged as the "best-case" interpretation for the contacts flat-path bug — *if* `/v1/contacts/*` is a legacy alias still served by a Pax8 gateway, the contacts ops might be working today despite being off-spec. Whether this is true is unverified.
- **D — v1/v2 functionally equivalent.** Ruled out for every webhook op by spec: the webhooks endpoints exist only at `/api/v2` per `webhooks-api.json paths.*`; nothing in `partner-endpoints.json` documents `/v1/webhooks*`.
- **E — routing override I missed.** Ruled out by inspection of `Pax8Client.buildUrl` (`packages/core/src/api/client.ts:267-278`) — it's a plain concat with no per-resource routing, no version rewriter, no per-call base override. Verified across all 6 domains.
- **F — draft-only by design, no API surface exists** (new; first use). The command performs a "write" from the partner's perspective (materializes durable state, prompts, takes an idempotency key, marks a write-in-flight) but the durable state is local-only. The CLI is transparent about it in `--help` and inline output, and the public spec confirms no API endpoint exists. Example: `invoices dispute`.

---

## 5. Methodology — what evidence we used

Each domain audit verified four things, in this order:

1. **Wire URL resolution.** Traced from the command handler → core API method → relative path → `Pax8Client.buildUrl()` and the resolved URL on the default base. The CLI claims are cited with `packages/...:lineno` paths. The resolution chain is: `Pax8Client` constructor at `packages/core/src/api/client.ts:53` sets `this.baseUrl = (options.baseUrl ?? getDefaultBaseUrl()).replace(/\/+$/, "")`; `getDefaultBaseUrl()` returns `FALLBACK_BASE_URL = "https://api.pax8.com/v1"` (`client.ts:20, 37-41`) unless `PAX8_API_BASE` is set; `buildUrl` (`client.ts:267-278`) does `new URL(${baseUrl}${path})` with no version munging or per-resource routing.

2. **Spec presence and version.** Confirmed via `jq '.paths | keys'` against the public OpenAPI specs (downloaded from `https://devx.pax8.com/openapi`):
   - `/tmp/partner-endpoints.json` (title "PARTNER ENDPOINTS", `info.version 1.0.0`, `servers[0].url https://api.pax8.com/v1`) — companies, subscriptions, orders, contacts, invoices, products, usage.
   - `/tmp/webhooks-api.json` (title "Webhooks Api", `info.version 1.0.0`, `servers[0].url https://api.pax8.com/api/v2`) — all webhook endpoints.
   - `/tmp/quoting-endpoints.json` (out of scope here; covered by `quotes-api-version.md`).

3. **Request body shape.** Verified from the spec's `paths.X.<method>.requestBody.content."application/json".schema`, resolving `$ref`s through `components.schemas.*`. **Response schemas were never used to infer request bodies** — a mistake the quotes audit made the first pass.

4. **Required-field coverage.** Read the spec's `required` arrays explicitly and cross-checked field-by-field against the CLI's outgoing body. For PUT operations: also checked whether the spec is PUT-full-replace or PATCH-partial-merge, and whether the CLI fetch-then-merges accordingly.

**Evidence inputs per claim:**

- CLI behavior: source code only (`packages/cli/src/commands/...`, `packages/core/src/api/...`). No subprocess runs against `PAX8_DEMO=1`, no sandbox API calls. `MockPax8Client` was not consulted — it accepts whatever shape the CLI sends and would mask wire mismatches.
- Spec behavior: the public OpenAPI JSON only. The spec is treated as the published contract: if the CLI's source comments contradict the spec (as they do for `subscriptions cancel`'s `cancelDate` typing), the audit flags both and reports — it does not infer one is right.
- Ambiguity: where the spec is silent, contradicts its own example, or where the spec required-field list contains a property that isn't declared on the schema (`orders create`'s per-line `companyId`), the audit reports the ambiguity and stops. No imputation.

**What this audit deliberately did NOT do:**

- Run live sandbox API calls. Would require credentials and is outside the scope of a paper audit.
- Test whether legacy aliases work. The CLI may be calling off-spec paths that work today by accident; this audit cites the spec as authority.
- Examine internal Pax8 routes (e.g., anything not in the public OpenAPI). The public contract is the only fact set used.
- Audit reads, computed surfaces, the recommendations engine, or the Quotes domain.

---

## 6. Why these problems weren't caught before

Same structural test gap as the quotes audit (`quotes-api-version.md §10`):

- **Subprocess CLI tests run in `PAX8_DEMO=1`** and exercise `MockPax8Client`, which accepts whatever shape the CLI builds. The wire URL and the body shape are invisible to demo tests.
- **Core API unit tests** (`packages/core/src/api/*.test.ts`) mock `Pax8Client.get/post/put/delete` with `vi.fn()` and assert on **relative path strings**. `buildUrl()` and `fetch()` are never invoked. The resolved wire URL is invisible.
- **No sandbox integration test** exists for any resource — verified for webhooks, contacts, companies, subscriptions, orders. Every layer of the test pyramid is below the wire, so a wrong base URL, a wrong path prefix, a missing required body field, or a wrong field name produces zero test failures.

Until a sandbox smoke test exists (even one read-only call per resource), every audit like this one has to be paper-only — and paper-only audits will keep missing problems the spec is precise about and the comments are vague about.

---

## 7. Methodology lessons (for the next audit)

Refined from the quotes audit retrospective and exercised across all six domains here:

1. **URL audit and body audit are separate verification tracks.** Finishing one is not finishing the other. The quotes audit's first pass verified URLs and stopped; the second pass found 5 of 10 quote operations had body-shape bugs too. This audit ran both passes for every operation from the start, and the body axis flagged independent problems on 5 of 14 wire-write operations that a URL-only audit would have missed.

2. **Code comments and Zod schema names are hypotheses, not evidence.** A schema labeled "Input for `POST /v2/quotes/...`" is not proof the schema matches what `POST /v2/quotes/...` accepts. The companies audit found `AddressSchema` claiming to model an address while using field names (`state`, `zip`) that no Pax8 spec uses anywhere. Comments are hypotheses; the spec's `requestBody` is the ground truth.

3. **Response-shape alignment ≠ request-shape alignment.** They're authored separately even within the same resource. The webhooks audit found `WebhookSchema` (read) is broadly aligned with the spec while `CreateWebhookInputSchema` (write) is structurally wrong (missing `displayName`, wrong topics shape). Same pattern likely exists in other domains; verify both directions when auditing any resource.

4. **Spec examples can contradict spec schemas.** The orders audit found three contradictions within `partner-endpoints.json` itself: `CreateLineItem.required` lists a property not declared on the schema; the canonical example uses different casing for `commitmentTermID`; and the example omits a schema-required `lineItemNumber`. When schema and example disagree, the schema is authoritative for contract verification, but the disagreement itself is worth reporting upstream.

5. **Read the `required` arrays carefully.** Multiple ops here are sending bodies that omit fields the spec lists as required (`companies create` missing 3 booleans; `webhooks create` missing `displayName`; `orders create` missing `lineItemNumber`; `contacts create` sending `phone` as optional when spec marks it required). Required-field omissions are 4xx contract violations, not warnings.

6. **Verbs matter.** `companies update` is the clearest example: the body is fine (true partial), the path is fine, the only thing wrong is the HTTP method (PUT vs spec's PATCH-only). A URL+body audit would still miss this if the verb axis isn't checked separately.

7. **`servers[0].url` is part of the wire URL.** Multi-spec APIs can use different base URLs per spec — `partner-endpoints.json` is `/v1`, `webhooks-api.json` is `/api/v2`, `quoting-endpoints.json` is unversioned with `/v2/...` paths. A single-baseUrl client (`Pax8Client`) cannot represent this; per-API or per-call base override is needed.

8. **`PAX8_DEMO=1` is a productivity feature, not a correctness check.** Demo mode swaps in `MockPax8Client`, which accepts whatever shape the CLI sends and returns synthetic data shaped however the CLI's *read* schemas define. It will pass every write-shape mistake silently. Don't rely on `pnpm test` as a wire-correctness signal.

---

## 8. Constraints honored

- **Read-only audit.** No source files (`packages/...`) were modified. The only files written by this audit are the seven markdown files under `docs/triage/api-version-audit/`.
- **No live sandbox API calls.** All evidence is from static source reads (CLI and core packages) and `jq` queries against the locally-downloaded public OpenAPI specs.
- **Every CLI claim cites a file path and line number.**
- **Every spec claim cites the OpenAPI path** (e.g., `partner-endpoints.json paths."/companies".post.requestBody.content."application/json".schema`).
- **Request bodies were verified from `requestBody` schemas only**, resolving `$ref`s explicitly. Response schemas were not used to infer request shapes.
- **Spec ambiguities are reported, not inferred away.** Where the spec is silent or self-contradicting, the report calls that out and stops.
- **Worktree isolation.** The audit ran in `/tmp/pax8-cli-api-audit` (branch `audit/write-api-versions` based on `origin/main`); the user's primary working checkout at `/Users/jdulberger/Documents/pax8-cli` (`fix/quotes-v2-wire-path`) was not touched.
