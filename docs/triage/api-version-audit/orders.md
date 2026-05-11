# Orders write API audit

**TL;DR:** `pax8 orders create` hits `POST https://api.pax8.com/v1/orders` — the wire URL matches the public OpenAPI spec exactly. The request **body**, however, has two discrepancies with the spec: (1) the CLI omits `lineItemNumber` on every line item even though `CreateLineItem` lists it as required; (2) the typed contract for `provisioningDetails` (a free-form `Record<string, unknown>`) doesn't match the spec's array-of-`{key, values[]}` shape — this is latent because the create command never populates it. The required-field gap is the load-bearing problem; everything else lines up.

## Operations audited

| Command | Source file:lines | Resolved URL | HTTP method |
|---|---|---|---|
| `pax8 orders create` (real) | `packages/cli/src/commands/orders/create.ts:574` → `packages/core/src/api/orders.ts:45-46` → `packages/core/src/api/client.ts:267-278` | `https://api.pax8.com/v1/orders` | `POST` |
| `pax8 orders create --dry-run` | same call site, `opts.isMock=true` | `https://api.pax8.com/v1/orders?isMock=true` | `POST` |
| `pax8 recommendations act` (constructs the same payload) | `packages/cli/src/commands/recommendations/act.ts:70-78` → same `OrdersApi.create()` | `https://api.pax8.com/v1/orders` | `POST` |

## Operation: orders create

### Wire path

- Command handler invokes the API at `packages/cli/src/commands/orders/create.ts:574`:
  `order = await ctx.api.orders.create(orderInput, { isMock: dryRun });`
- `OrdersApi.create()` builds the relative path at `packages/core/src/api/orders.ts:45-46`:
  `const path = opts?.isMock ? "/orders?isMock=true" : "/orders"; await this.client.post<unknown>(path, data);`
- `Pax8Client.post` delegates to `request("POST", path, body)` at `packages/core/src/api/client.ts:91-93`, which calls `buildUrl(path)` at `packages/core/src/api/client.ts:141`.
- `buildUrl` (`packages/core/src/api/client.ts:267-278`) concatenates `this.baseUrl` and a leading-slash-normalized path with no version munging.
- `baseUrl` is set in the constructor at `packages/core/src/api/client.ts:53` from `getDefaultBaseUrl()` which returns `FALLBACK_BASE_URL = "https://api.pax8.com/v1"` (`packages/core/src/api/client.ts:20, 37-41`) unless `PAX8_API_BASE` is set.
- **Resolved URL on default base:** `https://api.pax8.com/v1/orders` (real) or `https://api.pax8.com/v1/orders?isMock=true` (`--dry-run`). Note: the CLI inlines the query string into the path; `buildUrl` does `new URL(${baseUrl}${path})`, so `?isMock=true` is preserved verbatim into the URL's query string.

### Public spec location

- Spec file: `/tmp/partner-endpoints.json`
- `servers[0].url = "https://api.pax8.com/v1"` (no `/v2` server is declared).
- `paths."/orders".post` is documented with `operationId: createOrder`, request body `$ref: #/components/schemas/CreateOrder`, and a single query parameter `isMock` (boolean, optional). Match on URL is **clean**.

### Request body shape

CLI builds the body at `packages/cli/src/commands/orders/create.ts:554-564`:

```ts
const lineItems: OrderLineItemInput[] = resolvedLines.map((line, idx) => ({
  productId: line.productId,
  quantity: confirmedQuantities[idx],
  billingTerm: line.billingTerm as BillingTerm,
  ...(line.commitmentTermId ? { commitmentTermId: line.commitmentTermId } : {}),
}));
const orderInput: CreateOrderInput = { companyId: resolvedCompanyId, lineItems };
```

Zod typing for `OrderLineItemInput` is at `packages/core/src/api/types.ts:219-225`:
- `productId: z.string()`
- `quantity: z.number().int().min(1)`
- `billingTerm: BillingTermSchema.optional()` (enum matches spec)
- `commitmentTermId: z.string().optional()`
- `provisioningDetails: z.record(z.string(), z.unknown()).optional()`

Spec `CreateOrder` (resolved from `paths."/orders".post.requestBody.content."application/json".schema.$ref` → `components.schemas.CreateOrder`):
- `companyId` (uuid, required)
- `lineItems[]` of `CreateLineItem` (required)
- Top-level extras allowed/permitted by spec but not required: `orderedBy` (enum), `orderedByUserEmail`.

Spec `CreateLineItem` (`components.schemas.CreateLineItem`):
- `productId` (uuid) — **required**
- `companyId` (uuid) — **required** per `required` array (likely a spec bug; not in the example; nesting `companyId` inside each line item is inconsistent with the top-level body and with the canonical example. See "spec ambiguities" below.)
- `lineItemNumber` (number) — **required**, marked `writeOnly`. Description: "Required. Number used as a reference to the line item for parent line items."
- `quantity` (number) — **required**
- `billingTerm` (enum) — **required**
- Optional: `commitmentTermId`, `provisionStartDate`, `parentSubscriptionId`, `parentLineItemNumber`, `provisioningDetails` (array of `ProvisioningDetail`)

**Field-by-field diff (top-level body):**

| Field | CLI sends | Spec requires | Verdict |
|---|---|---|---|
| `companyId` | yes (UUID resolved from `--company`) | required | match |
| `lineItems` | yes, array with ≥1 | required | match |
| `orderedBy` | no | optional | n/a |
| `orderedByUserEmail` | no | optional | n/a |

**Field-by-field diff (per line item):**

| Field | CLI sends | Spec requires | Verdict |
|---|---|---|---|
| `productId` | yes | required | match |
| `quantity` | yes (positive int) | required | match |
| `billingTerm` | yes (Monthly default) | required | match |
| `lineItemNumber` | **NO** | **required** | **MISSING** |
| `companyId` (per-line) | no | required per `required` array | spec ambiguity (see below) |
| `commitmentTermId` | conditional (only when resolved) | optional (but required when product `requiresCommitment`) | match |
| `provisioningDetails` | not sent by `orders create`; typed as `z.record(string, unknown)` in `OrderLineItemInputSchema` | array of `{key, values[], …}` | latent shape mismatch (never exercised by the create command) |
| `provisionStartDate`, `parentSubscriptionId`, `parentLineItemNumber` | no | optional | n/a |

The CLI body is fundamentally well-shaped (flat list of line items, no rogue nesting), but it is **missing the required `lineItemNumber`** on every line item.

### Required field coverage

Spec `CreateLineItem.required = ["productId", "companyId", "lineItemNumber", "quantity", "billingTerm"]`. CLI satisfies `productId`, `quantity`, `billingTerm`. CLI does NOT send `lineItemNumber`. Per-line `companyId` is in the required list but absent from the spec's own canonical example — see ambiguities.

Spec `CreateOrder.required = ["companyId", "lineItems"]`. CLI satisfies both.

### Reconciliation case

**B' (body-shape-only).** Wire URL is correct on `/v1`. Body is missing a spec-required line-item field (`lineItemNumber`), and there is a latent type-shape mismatch on `provisioningDetails` that isn't exercised by the CLI today. No URL-version issue.

### Recommendation

Populate `lineItemNumber` on each outgoing line item (sequential 1-based index, matching the spec's `parentLineItemNumber` referencing model), and reconcile `OrderLineItemInputSchema.provisioningDetails` with the spec's `Array<ProvisioningDetail>` shape (`{key: string, values: string[]}[]`) before any feature begins sending it; either fix the typing and convert at the wire, or accept the spec shape directly in CLI input.

## Other notes

- **Idempotency at the wire.** The CLI accepts `--idempotency-key <uuid>` but the explicit `TODO` at `packages/cli/src/commands/orders/create.ts:566-570` confirms the key is **not** sent to the API as a header or in the body — deduplication is purely local via the file cache in `withIdempotency`. The spec's `POST /orders` defines no `Idempotency-Key` header parameter, so this is consistent with the documented API (but means retries that bypass the local cache could double-create).
- **Recommendation acceptance path.** `pax8 recommendations act` at `packages/cli/src/commands/recommendations/act.ts:70-78` builds the same body shape — `{companyId, lineItems: [{productId, quantity, billingTerm, commitmentTermId?}]}` — through `ctx.api.orders.create()`. Same missing `lineItemNumber`, same wire URL. No divergence.
- **Demo vs real branching.** `buildContext()` at `packages/cli/src/lib/context.ts:135-142` swaps in `MockPax8Client` when `PAX8_DEMO=1` or no credentials are set. Demo mode never calls `Pax8Client.post`, so the request body never reaches the wire under `PAX8_DEMO=1`. The command code is unbranched on `PAX8_DEMO` (per the convention in `CLAUDE.md`); the same `orderInput` is what would be POSTed in real mode.
- **`isMock` placement.** The CLI puts `isMock=true` into the path string before passing to `client.post`. `buildUrl` parses this via `new URL()`, which preserves the query string, so it lands as a real URL query parameter — matching the spec's `parameters[].in: "query"`. Correct, just an unusual idiom (most other paths use the `params` argument).
- **Spec ambiguities (unresolved):**
  1. `CreateLineItem.required` lists `companyId`, but `companyId` is not declared as a property of `CreateLineItem` and is absent from the spec's own `microsoft-office-365-e3-order` example. Almost certainly a spec bug; the CLI's behavior (only top-level `companyId`) matches the example.
  2. The example uses `commitmentTermID` (capital ID) where the schema declares `commitmentTermId`. The schema name is authoritative; the example is likely a typo. CLI uses the lowercase form.
  3. `lineItemNumber` is marked required in the schema but is absent from the example. Hard to say which is canonical; safer interpretation is that the schema is authoritative since at least one provisioning-heavy or parent/child order will need it. Worth confirming with Pax8 platform before patching.

## Constraints honored

- READ-ONLY (no source files modified).
- All CLI claims cite worktree-relative file paths and line numbers.
- All spec claims cite specific OpenAPI paths under `/tmp/partner-endpoints.json`.
- Request body shape verified from `requestBody.content.application/json.schema` and `components.schemas.CreateOrder`/`CreateLineItem`, not from response schemas.
- No live API calls.
