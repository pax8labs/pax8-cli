# 01 — API conformity (read surfaces)

## Methodology

Verified wire URLs match OpenAPI specs (`partner-endpoints.json`, `quoting-endpoints.json`, `webhooks-api.json`, `vendor-provisioning-endpoints.json`, `vendor-usage-endpoints.json`) using `jq`. Checked Zod schemas against the spec's `components.schemas` for shape conformity. Inspected command handlers for pagination, filtering, sorting, and error handling — focusing on the surfaces listed below.

**Out of scope (already audited in earlier passes):** write operations, pre-#379 company/client surface, pre-#325 contact types.

**Scope covered:** `subscriptions list/show/renewals`, `companies list/show`, `contacts list/show`, `invoices list/show/audit`, `orders list/show`, `quotes list/show/line-items`, `webhooks list/show/logs`, `usage` surfaces, `recommendations list`, `report mrr/growth`, `dashboard`, `products` catalog. Did NOT fully audit every CLI command's error handling, just spot-checked critical paths.

## Summary

- **1 block-launch** — quotes API shape mismatch (companyId vs. client object)
- **3 fix-before-launch** — missing filter parameters exposed by spec (quotes status, companies geo, invoices advanced; CLI clients downstream could work around via spec-native calls but should have CLI support)
- **2 fix-soon-after-launch** — incomplete feature disclosure (STAX divergence on recommendations not prominent; usage shows no pagination contract)
- **1 accept** — invoice status field missing from OpenAPI but present on wire (acceptable defensive optional in schema)

## Findings

### block-launch — Quotes API — Schema mismatch on client identifier

**File:** `packages/core/src/api/types.ts:659-692`, `packages/core/src/api/quotes.ts:94-96`

**Evidence:**

OpenAPI v2 `/quotes` response schema (`quoting-endpoints.json` → `components.schemas.QuoteResponse`):
```json
{
  "client": {
    "$ref": "#/components/schemas/ClientDetails"
  }
  // where ClientDetails = { id, isShadowCompany, name } — all required
}
```

Zod schema in `types.ts:661`:
```typescript
companyId: z.string(),
```

The API returns a nested `client` object; the Zod schema expects a flat `companyId` string. Quotes API does no transformation (line 96: `return QuoteSchema.parse(raw)`). Default Zod behavior drops unknown keys, so the real API will silently drop `client.*` and leave `companyId` undefined, failing validation.

**Why it matters:** Partners calling `pax8 quotes list` or `pax8 quotes show` against the real Pax8 API will get a silent Zod parsing failure or undefined `companyId` values, breaking quote drill-downs and company filtering. Demo mode masks this because mock data carries `companyId` directly.

**Recommended fix:** Transform the API response to flatten `client.id` → `companyId` before Zod parsing, mirroring the approach used for ContactType (#325) and InvoiceItem (#273). Alternatively, restructure the Zod schema to accept both shapes defensively (e.g., `.transform()`).

---

### fix-before-launch — Quotes API — Missing status filter on list

**File:** `packages/cli/src/commands/quotes/list.ts:59-64`, `packages/core/src/api/quotes.ts:81-92`

**Evidence:**

OpenAPI spec (`quoting-endpoints.json` → `/v2/quotes` GET parameters):
```json
{
  "name": "status",
  "schema": {
    "enum": ["draft", "assigned", "sent", "closed", "declined", "accepted", "changes_requested", "expired", "pending"]
  }
}
```

CLI command line 59-60:
```typescript
// The Pax8 API doesn't expose a status filter on quotes list,
// so honor --status client-side.
```

The spec clearly supports server-side status filtering, but the CLI comment claims it doesn't. Core API (`quotes.ts:81-92`) doesn't pass `status` to the server — it only accepts `{ page, size, companyId }`.

**Why it matters:** Partners listing large quote volumes can't filter server-side; they must fetch all quotes and filter locally, wasting bandwidth and hitting pagination limits. The spec supports this.

**Recommended fix:** Add `status?: string` parameter to `QuotesApi.list()` and thread it through to the HTTP GET. Update the CLI's `--status` flag to pass the parameter server-side instead of client-side filtering.

---

### fix-before-launch — Companies API — Missing geography/filter parameters

**File:** `packages/core/src/api/companies.ts:19-22`, `packages/cli/src/commands/companies/list.ts:70-74`

**Evidence:**

OpenAPI spec (`partner-endpoints.json` → `/companies` GET parameters):
```json
{
  "name": "city",     "schema": { "type": "string" }
},
{
  "name": "country",  "schema": { "type": "string" }
},
{
  "name": "stateOrProvince", "schema": { "type": "string" }
},
{
  "name": "postalCode", "schema": { "type": "string" }
},
{
  "name": "selfServiceAllowed",  "schema": { "type": "boolean" }
},
{
  "name": "billOnBehalfOfEnabled", "schema": { "type": "boolean" }
},
{
  "name": "orderApprovalRequired", "schema": { "type": "boolean" }
},
{
  "name": "sort", "schema": { "enum": ["name", "city", "country", "stateOrProvince", "postalCode"] }
}
```

Core API (`companies.ts:19`) only accepts:
```typescript
async list(params?: { page?: number; size?: number; status?: string; filter?: string })
```

The `filter` parameter is generic and doesn't align to any documented OpenAPI parameter. The spec's geography and capabilities filters are completely missing.

**Why it matters:** Partners can't filter companies by location or business rules without downloading all companies locally. This limits usefulness for large portfolios with geographic segmentation needs.

**Recommended fix:** Add typed parameters for `city`, `stateOrProvince`, `country`, `postalCode`, `selfServiceAllowed`, `billOnBehalfOfEnabled`, `orderApprovalRequired`, and `sort` to `CompaniesApi.list()`. Update the CLI's `companies list` command to expose these as options.

---

### fix-before-launch — Invoices API — Missing advanced filters

**File:** `packages/core/src/api/invoices.ts:20-27`, `packages/cli/src/commands/invoices/list.ts`

**Evidence:**

OpenAPI spec (`partner-endpoints.json` → `/invoices` GET parameters) supports:
```json
{
  "name": "status", "enum": ["Unpaid", "Paid", "Void", "Carried", "Nothing Due", "Credited"]
},
{
  "name": "sort", "enum": ["invoiceDate", "dueDate", "status", "partnerName", "total", "balance", "carriedBalance"]
},
{
  "name": "invoiceDateRangeStart", "format": "yyyy-MM-dd"
},
{
  "name": "invoiceDateRangeEnd", "format": "yyyy-MM-dd"
},
{
  "name": "dueDate", "format": "yyyy-MM-dd"
},
{
  "name": "total", "type": "number"
},
{
  "name": "balance", "type": "number"
},
{
  "name": "carriedBalance", "type": "number"
}
```

Core API (`invoices.ts:20-27`) only accepts:
```typescript
async list(params?: {
  page?: number;
  size?: number;
  invoiceDate?: string;   // Note: mapped from CLI --month
  month?: string;
  companyId?: string;
  status?: string;        // Accepted but not surfaced in CLI
})
```

Notably missing: `sort`, date-range parameters, balance filters. The CLI's `invoices list` doesn't expose `status` as a flag even though the core API accepts it.

**Why it matters:** Partners can't efficiently locate unpaid invoices or overdue items without local filtering. The audit surface (`pax8 invoices audit`) is unaffected since it does multi-step matching, but the read surface is incomplete.

**Recommended fix:** Add `sort`, `invoiceDateRangeStart`, `invoiceDateRangeEnd`, `dueDate`, `total`, `balance`, `carriedBalance` parameters to `InvoicesApi.list()`. Surface status filter in the CLI (`--status Unpaid`, `--status Paid`, etc.). Consider date-range flags (`--from YYYY-MM-DD`, `--to YYYY-MM-DD`) for ergonomics.

---

### fix-soon-after-launch — Recommendations — STAX divergence not disclosed

**File:** `packages/cli/src/commands/recommendations/list.ts:77-91`

**Evidence:**

Help text (lines 77-91) discloses that the CLI's seat-gap heuristic is not the same as Pax8's Seat Utilization metric and is "closest OE surrogate is Upsell" and "will likely be retired or remapped when OE's first-party API ships."

However:
1. The disclosure is in the `pax8 recommendations list --help` output, not in `--json` output where automated consumers might miss it.
2. The comment says "CLI-invented heuristic" — this is accurate but could be more prominent in the README or docs.
3. The `opportunityType` field maps the legacy `type` field to OE's canonical taxonomy, but this mapping logic is in the command handler, not documented in `packages/core`.

**Why it matters:** Partners integrating `--json` output into scripts/dashboards may not discover that seat_gap diverges from Pax8's internal definitions. Low urgency since the `opportunityType` field provides the canonical taxonomy, but disclosure clarity matters for trust.

**Recommended fix:** Add a note to `packages/core/README.md` or `docs/FEATURES.md` documenting the seat_gap heuristic and its eventual retirement. Optionally add an `internalNote` field to the JSON output flagging divergences (though this adds surface complexity).

---

### fix-soon-after-launch — Usage API — No pagination contract disclosed

**File:** `packages/core/src/api/usage.ts:29-42`, `packages/cli/src/commands/usage/list.ts`

**Evidence:**

`UsageApi.listSummaries()` returns `PaginatedResponse<UsageSummary>`, suggesting paging is available. However:
1. The OpenAPI spec doesn't explicitly document whether `/subscriptions/{id}/usage-summaries` supports `page` and `size` parameters (not verified in this audit).
2. The CLI command doesn't surface pagination flags.
3. The response contract (`page.totalElements`, `page.totalPages`) suggests paging, but there's no help text or flag documentation about how pagination works or when results are truncated.

**Why it matters:** Partners with high-usage subscriptions may not discover that results are paginated or truncated. Low severity since usage-summaries are typically small, but undocumented pagination contracts can surprise users with large datasets.

**Recommended fix:** Document the pagination behavior in the CLI help text. Consider adding `--page` and `--size` flags to `usage list` for parity with other list commands. Verify the spec's pagination contract against the implementation.

---

### accept — Invoices API — Status field missing from OpenAPI but on wire

**File:** `packages/core/src/api/types.ts:543-556`

**Evidence:**

OpenAPI spec (`partner-endpoints.json` → `components.schemas.Invoice.properties`) lists:
```json
["balance", "carriedBalance", "companyId", "currencyCode", "dueDate", "externalId", "id", "invoiceDate", "partnerName", "total"]
```

No `status` field.

Zod schema (line 552):
```typescript
status: InvoiceStatusSchema.optional(),
```

Comment (lines 548-550):
```typescript
// Optional defensively: the public OpenAPI Invoice properties block does
// not declare `status`, even though the field appears in the spec's
// example response. Until the spec is fixed, partners reading the schema
// could legitimately produce payloads without this field.
```

**Why it matters:** The OpenAPI docs are incomplete (the spec's example does include `status`), but the CLI correctly defends against this gap. No action needed.

**Recommended fix:** None — the schema is correctly defensive. Document this in the next Pax8 API docs audit.

---

### accept — Subscriptions API — Client implements core parameters, CLI doesn't expose all

**File:** `packages/core/src/api/subscriptions.ts:21-29`, `packages/cli/src/commands/subscriptions/list.ts:47-88`

**Evidence:**

OpenAPI spec (`partner-endpoints.json` → `/subscriptions` GET parameters) supports:
```json
{
  "name": "status",       "enum": [all 10 values matching CLI help — ✓ matches]
},
{
  "name": "billingTerm",  "enum": ["Monthly", "Annual", "2-Year", "3-Year", "One-Time", "Trial", "Activation"]
},
{
  "name": "productId",    "format": "uuid"
},
{
  "name": "sort",         "enum": ["quantity,asc|desc", "startDate,asc|desc", ...]
}
```

CLI only exposes `--company`, `--status`, `--page`, `--size`. Core API accepts these but **not** `billingTerm`, `productId`, or `sort` parameters.

**Why it matters:** Partners can't filter subscriptions by billing term or product from the CLI (must use the API directly or filter locally). The gaps are less critical than other surfaces since `subscriptions list --company X` is the primary use case, but completeness is impacted.

**Recommended fix:** Optional enhancement for v0.1.1+: add `--billing-term`, `--product`, and `--sort` flags to `subscriptions list`. Update core API to accept and pass these parameters.

---

## Out of Scope

- Write operation surfaces (already audited in `docs/triage/api-version-audit/`)
- Error-handling exhaustiveness (only spot-checked critical failures)
- All CLI UX/affordance details (focused on API conformity)
- Vendor usage/provisioning endpoints (read paths confirmed URLs match spec; detailed schema audit deferred)

