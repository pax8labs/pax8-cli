# Subscriptions write API audit

**TL;DR:** Both subscription write operations hit the **correct wire URL** at the version the public spec documents (`/v1/subscriptions/{id}`). `subscriptions update` is **wire-clean and body-clean** — it sends a partial `{quantity?, billingTerm?}` body via `PUT`, which conforms to the spec's `anyOf` requirement that "at least one of {price, billingTerm, quantity, startDate}" be present. `subscriptions cancel` is **wire-clean** but has a **minor body/query format deviation (B')**: the CLI sends `cancelDate=YYYY-MM-DD` (date-only) while the spec types `cancelDate` as `string, format: date-time` with an offset example (`2000-10-31T01:30:00.000-05:00`). Whether the API accepts the shorter form is empirically unverified — flagged for confirmation, not a confirmed bug.

## Operations audited

| Command | Source file:lines | Resolved URL (default base) | HTTP method |
|---|---|---|---|
| `pax8 subscriptions update <id>` | `packages/cli/src/commands/subscriptions/update.ts:177` → `packages/core/src/api/subscriptions.ts:41-44` | `https://api.pax8.com/v1/subscriptions/{id}` | `PUT` |
| `pax8 subscriptions cancel <id>` | `packages/cli/src/commands/subscriptions/cancel.ts:246-249` → `packages/core/src/api/subscriptions.ts:51-54` | `https://api.pax8.com/v1/subscriptions/{id}?cancelDate=<date>` (query optional) | `DELETE` |

Wire-URL trace (shared):
- `Pax8Client` constructor sets `this.baseUrl = (options.baseUrl ?? getDefaultBaseUrl()).replace(/\/+$/, "")` at `packages/core/src/api/client.ts:53`.
- `getDefaultBaseUrl()` returns `FALLBACK_BASE_URL = "https://api.pax8.com/v1"` when `PAX8_API_BASE` is unset (`packages/core/src/api/client.ts:20`, `37-41`).
- `buildUrl(path, params)` concatenates `${this.baseUrl}${normalizedPath}` (`packages/core/src/api/client.ts:267-278`) — no version override, no rewriting.
- `SubscriptionsApi.update` passes the literal path `/subscriptions/${id}` to `client.put` (`packages/core/src/api/subscriptions.ts:42`).
- `SubscriptionsApi.delete` passes `/subscriptions/${id}` to `client.delete` with the `cancelDate` query param (`packages/core/src/api/subscriptions.ts:51-54`).

---

## Operation: subscriptions update

### Wire path
`PUT https://api.pax8.com/v1/subscriptions/{id}`.
- CLI handler calls `ctx.api.subscriptions.update(id, updateData)` at `packages/cli/src/commands/subscriptions/update.ts:177`.
- `SubscriptionsApi.update` calls `this.client.put<unknown>(\`/subscriptions/${id}\`, data)` at `packages/core/src/api/subscriptions.ts:42`.
- `client.put` issues `PUT` to `buildUrl("/subscriptions/${id}")` → `https://api.pax8.com/v1/subscriptions/{id}` (see shared trace above).

### Public spec location
Documented at `partner-endpoints.json paths."/subscriptions/{subscriptionId}".put` with `operationId: updateSubscription`. The spec's `servers[0].url` is `https://api.pax8.com/v1`, so the spec endpoint resolves to the same URL the CLI hits. No `v2` alternative exists in this spec (`jq '.paths | keys[] | select(test("subscription"; "i"))' /tmp/partner-endpoints.json` returns only `/subscriptions`, `/subscriptions/{subscriptionId}`, `/subscriptions/{subscriptionId}/history`, and `/subscriptions/{subscriptionId}/usage-summaries`).

### Request body shape
CLI body construction (`packages/cli/src/commands/subscriptions/update.ts:140-164`):
```
const updateData: Record<string, unknown> = {};
if (options.quantity !== undefined)    updateData.quantity = newQty;       // number
if (options.billingTerm)               updateData.billingTerm = options.billingTerm;  // string
```
Zod input contract at `packages/core/src/api/types.ts:324-328`:
```
UpdateSubscriptionInputSchema = z.object({
  quantity: z.number().int().min(1).optional(),
  billingTerm: BillingTermSchema.optional(),
});
```

Spec request body at `partner-endpoints.json paths."/subscriptions/{subscriptionId}".put.requestBody.content."application/json".schema`:
```
allOf: [
  { $ref: "#/components/schemas/Subscription" },          // all properties optional in the schema itself
  { anyOf: [
      { required: ["price"],       properties: { price: number } },
      { required: ["billingTerm"], properties: { billingTerm: enum } },
      { required: ["quantity"],    properties: { quantity: number } },
      { required: ["startDate"],   properties: { startDate: date-time } }
  ]}
]
```
Spec description: "Updates a subscription... At least one of the following fields are required: Price, BillingTerm, Quantity, StartDate".

**Diff:** The CLI sends `quantity` and/or `billingTerm` — both are members of the spec's `anyOf` block. Field names match (`quantity`, `billingTerm`); types match (number, enum); the `BillingTermSchema` in `packages/core/src/api/types.ts:25-33` enumerates exactly the seven values the spec lists. No extra fields, no nesting mismatch. The CLI guards against the empty case at `update.ts:166-171` ("No changes specified. Use --quantity or --billing-term."), so it never sends an empty body that would violate the `anyOf`.

### Required field coverage
- The Subscription branch of `allOf` has **no `required` array** at the top level; all referenced subscription fields are optional. So the `Subscription` allOf member does not, by itself, require any field.
- The `anyOf` block requires at least one of `{price, billingTerm, quantity, startDate}`. The CLI's quantity/billingTerm flags both satisfy this.
- The CLI does **not** fetch-then-merge — it sends only the changed field(s). This is correct given the spec's `anyOf` requirement (partial bodies are explicitly supported). No "PUT-as-full-replace" risk because the schema's other top-level fields are not in any `required` set.
- Commitment-aware pre-flight (`update.ts:79-138`) is a CLI-side guardrail (quantity decreases blocked, billing-term changes blocked when an active commitment is present). This never hits the API; it just short-circuits with `CliError(ERROR_API_VALIDATION)` before constructing the body. Not a spec-conformance issue.

### Reconciliation case (A–E)
**A — deliberate-and-correct.** Wire URL matches; body shape conforms to the `anyOf` requirement; field names and types align with the spec. The commitment pre-flight is a deliberate UX layer in front of an API the spec doesn't constrain, and it never alters the wire body.

### Recommendation
**Clean.** No wire or body fix needed. The fetch-then-merge question doesn't apply because the spec explicitly supports partial updates via the `anyOf` block.

---

## Operation: subscriptions cancel

### Wire path
`DELETE https://api.pax8.com/v1/subscriptions/{id}` with optional `?cancelDate=<date>` query.
- CLI handler calls `ctx.api.subscriptions.delete(id, effectiveCancelDate ? { cancelDate: effectiveCancelDate } : undefined)` at `packages/cli/src/commands/subscriptions/cancel.ts:246-249`.
- `SubscriptionsApi.delete` forwards as `await this.client.delete(\`/subscriptions/${id}\`, query)` at `packages/core/src/api/subscriptions.ts:51-54`.
- `client.delete` calls `request("DELETE", path, undefined, params)` at `packages/core/src/api/client.ts:103-105`, which feeds `params` through `buildUrl` and emits each entry as `url.searchParams.set(key, String(value))` (`client.ts:270-275`). Resolved URL: `https://api.pax8.com/v1/subscriptions/{id}?cancelDate=2026-12-31` (when scheduled).

### Public spec location
Documented at `partner-endpoints.json paths."/subscriptions/{subscriptionId}".delete` with summary `"Cancel Subscription"` (no `operationId` listed in the spec block). Spec confirms there is **no separate `/cancel` sub-endpoint** — cancellation rides the DELETE verb with an optional `cancelDate` query parameter. The CLI's wire path is structurally correct.

### Request body shape
DELETE has **no request body** in the spec (no `requestBody` key under the delete operation). The CLI also sends no body — `client.delete` only ever calls `request("DELETE", path, undefined, params)` with `body` undefined (`client.ts:103-105`, and `init.body` is only set when `body !== undefined` per `client.ts:155-157`). The relevant payload surface is the `cancelDate` query parameter.

Spec definition of `cancelDate` (`partner-endpoints.json paths."/subscriptions/{subscriptionId}".delete.parameters[1]`):
```
{
  name: "cancelDate",
  in: "query",
  required: false,
  schema: { type: "string", format: "date-time", example: "2000-10-31T01:30:00.000-05:00" }
}
```

CLI emits `cancelDate` in `YYYY-MM-DD` form (date-only). The CLI flag validator (`cancel.ts:45-78`, `parseCancelDate`) enforces the strict shape `^\d{4}-\d{2}-\d{2}$`, rejects timestamps explicitly, and round-trips through `new Date()` for semantic validity. The value passes through `client.delete → buildUrl` verbatim as the query string value.

**Diff:**
- Spec format: `string, format: date-time` (RFC 3339 / ISO 8601 timestamp with offset, per the spec's example).
- CLI format: `string` matching `YYYY-MM-DD` (calendar date, no time, no zone).
- Field name (`cancelDate`) matches; location (query param) matches; presence requirement (optional) matches.

The CLI source comments at `cancel.ts:44-45` claim "the Pax8 API treats `cancelDate` as a date (not a timestamp), and accepting timestamps would silently drop the time portion." That assertion contradicts the public spec's `format: date-time` typing. Either:
- The spec is wrong and the API actually treats it as a date (the CLI's documented assumption); or
- The spec is right and the API accepts a date-time, in which case the CLI's date-only string may be accepted leniently (most JSON-Schema `date-time` consumers do) or may be rejected by stricter parsers.

This is unverified from spec alone — the spec is the published contract and types it as `date-time`; the CLI ships against the opposite assumption.

### Required field coverage
Not applicable for DELETE in this spec — there is no `requestBody`, and the only parameter that could carry payload data (`cancelDate`) is explicitly `required: false`. The CLI honors that: immediate cancellation sends no query param at all (`cancel.ts:248`, conditional `effectiveCancelDate ? {...} : undefined`).

No fetch-then-merge needed; there is no body to merge. The pre-flight `subscriptions.get(id)` at `cancel.ts:126` is purely for the commitment-aware preview block and is not used to populate any payload field.

### Reconciliation case (A–E)
**B' — body-shape-only deviation (query-param format).** Wire URL and HTTP method are correct, and DELETE has no JSON body so there's no "body" in the strict sense — but the published spec types `cancelDate` as `date-time` and the CLI sends `date`. The deviation is mild (most APIs accept the shorter form leniently) but it is a documented contract mismatch, so it's not pure A.

### Recommendation
**Needs body-shape confirmation.** Either (a) the CLI's `parseCancelDate` should also accept full ISO `date-time` strings and forward them through to align with the spec, or (b) the spec should be updated to `format: date` if the CLI's comment is correct and the API actually rejects timestamps. The wire URL itself is clean. Confirming with the marketplace API team (e.g., via sandbox test of both forms) is the cheapest path to resolution.

---

## Constraints honored
- Read-only audit: no code edits, no `pax8` commands executed, no sandbox API calls.
- Every CLI claim cites `packages/...` paths with line numbers (e.g., `packages/cli/src/commands/subscriptions/cancel.ts:246-249`, `packages/core/src/api/client.ts:53`, `packages/core/src/api/types.ts:324-328`).
- Every spec claim cites the OpenAPI path inside `partner-endpoints.json` (e.g., `paths."/subscriptions/{subscriptionId}".put.requestBody.content."application/json".schema`, `paths."/subscriptions/{subscriptionId}".delete.parameters[1]`).
- Body shapes were resolved from the OpenAPI **request body** schemas (and the spec's DELETE `parameters[1]` for the cancel query) — not inferred from response schemas.
- Where the spec is ambiguous (date-only vs date-time tolerance on cancel), the ambiguity is reported, not inferred away.
