# Webhooks write API audit

**TL;DR:** Every CLI webhooks write operation appears to hit the wrong wire URL. The public webhooks OpenAPI spec (title `Webhooks Api`, `info.version 1.0.0`) declares `servers[0].url: https://api.pax8.com/api/v2`, but `Pax8Client` is hard-pinned to `FALLBACK_BASE_URL = "https://api.pax8.com/v1"` (`packages/core/src/api/client.ts:20`) and `WebhooksApi` sends only relative paths like `/webhooks` and `/webhooks/{id}/status` — so every call lands at `https://api.pax8.com/v1/webhooks/...` instead of `https://api.pax8.com/api/v2/webhooks/...`. This is the same class of bug as the Quotes `/v1` vs `/v2` finding, but with the more unusual `/api/v2` prefix. **In addition**, three operations have body-shape and HTTP-method mismatches that would still be wrong even after the base URL is corrected:

1. `webhooks create` sends `{ url, topics: string[] }`, but the spec's `CreateWebhook` schema requires `displayName` (mandatory), accepts `url` as optional, and expects `webhookTopics: Array<{ topic, filters }>` rather than a flat string array.
2. `webhooks update` issues `PUT /webhooks/{id}` with `{ displayName?, url?, authorization?, contactEmail?, errorThreshold? }`, but the spec has **no `PUT` (or `PATCH`) on `/webhooks/{id}` at all** — configuration changes live at `POST /webhooks/{id}/configuration`. (Confusingly, the core helper `WebhooksApi.updateConfiguration` already targets the correct path — but `webhooks update` calls `updateConfiguration` ✓, while `WebhooksApi.update` (`PUT /webhooks/{id}`) is dead-end wrong and still callable.)
3. `webhooks enable` / `webhooks disable` body shape is correct (`{ active: boolean }`) and the relative path is correct (`/webhooks/{id}/status`), but on top of the base-URL mismatch there is a stale `WebhooksApi.updateStatus` helper that issues `PATCH /webhooks/{id}` with `{ status }` — not what enable/disable call, but a latent foot-gun.

Net effect: even after a `/v1` → `/api/v2` base-path correction, `create` and the dead `update`/`updateStatus` helpers would still fail server-side validation. `delete`, `setStatus` (`enable`/`disable`), and `retryLog` (`logs retry`) are wire-clean modulo the base-URL prefix.

## Operations audited

| Command | Source file:lines | Resolved URL (default base, today) | HTTP method | Spec path (`https://api.pax8.com/api/v2`) |
|---|---|---|---|---|
| `pax8 webhooks create` | `packages/cli/src/commands/webhooks/create.ts:142` → `packages/core/src/api/webhooks.ts:26-29` | `https://api.pax8.com/v1/webhooks` | `POST` | `paths."/webhooks".post` |
| `pax8 webhooks update <id>` | `packages/cli/src/commands/webhooks/update.ts:170` → `packages/core/src/api/webhooks.ts:51-60` (`updateConfiguration`) | `https://api.pax8.com/v1/webhooks/{id}/configuration` | `POST` | `paths."/webhooks/{id}/configuration".post` |
| `pax8 webhooks enable <id>` | `packages/cli/src/commands/webhooks/enable.ts:69` → `packages/core/src/api/webhooks.ts:67-70` (`setStatus`) | `https://api.pax8.com/v1/webhooks/{id}/status` | `POST` | `paths."/webhooks/{id}/status".post` |
| `pax8 webhooks disable <id>` | `packages/cli/src/commands/webhooks/disable.ts:70` → `packages/core/src/api/webhooks.ts:67-70` (`setStatus`) | `https://api.pax8.com/v1/webhooks/{id}/status` | `POST` | `paths."/webhooks/{id}/status".post` |
| `pax8 webhooks delete <id>` | `packages/cli/src/commands/webhooks/delete.ts:56` → `packages/core/src/api/webhooks.ts:72-74` | `https://api.pax8.com/v1/webhooks/{id}` | `DELETE` | `paths."/webhooks/{id}".delete` |
| `pax8 webhooks logs retry <log-id>` | `packages/cli/src/commands/webhooks/logs.ts:328` → `packages/core/src/api/webhooks.ts:99-101` | `https://api.pax8.com/v1/webhooks/{webhookId}/logs/{logId}/retry` | `POST` | `paths."/webhooks/{webhookId}/logs/{logId}/retry".post` |

### Shared wire-URL trace

- `Pax8Client` constructor: `this.baseUrl = (options.baseUrl ?? getDefaultBaseUrl()).replace(/\/+$/, "")` (`packages/core/src/api/client.ts:53`).
- `getDefaultBaseUrl()` returns `FALLBACK_BASE_URL = "https://api.pax8.com/v1"` when `PAX8_API_BASE` is unset (`packages/core/src/api/client.ts:20`, `37-41`).
- `buildUrl(path, params)` concatenates `${this.baseUrl}${normalizedPath}` (`packages/core/src/api/client.ts:267-278`). **No per-call base override or version rewriter exists** — every `WebhooksApi.*` relative path inherits the shared `/v1` prefix.
- The webhooks spec at `webhooks-api.json servers[0].url` is `https://api.pax8.com/api/v2`. Resolution mismatch: CLI hits `/v1/webhooks/...`, spec documents `/api/v2/webhooks/...`. **Same class of bug as Quotes `/v1` vs `/v2`, with a different (more unusual) prefix.**

---

## Per-operation findings

### Operation: webhooks create

**Wire path.** CLI handler at `packages/cli/src/commands/webhooks/create.ts:142` calls `ctx.api.webhooks.create({ url, topics })`. `WebhooksApi.create` at `packages/core/src/api/webhooks.ts:26-29` issues `POST` to the literal relative path `/webhooks`. Resolved against the default base, this becomes `POST https://api.pax8.com/v1/webhooks`.

**Public spec location.** `webhooks-api.json paths."/webhooks".post` (`operationId: Webhooks_create`). Per `servers[0].url`, the canonical resolved endpoint is `POST https://api.pax8.com/api/v2/webhooks` — the CLI is sending to the wrong base prefix.

**Request body shape.** CLI sends:
```json
{ "url": "https://example.com/hook", "topics": ["subscription.created", "invoice.paid"] }
```
Zod input contract at `packages/core/src/api/types.ts:510-514`:
```ts
CreateWebhookInputSchema = z.object({
  url: z.string().url(),
  topics: z.array(z.string()).min(1),
});
```

Spec request body at `webhooks-api.json paths."/webhooks".post.requestBody.content."application/json".schema.$ref = "#/components/schemas/CreateWebhook"`:
```jsonc
{
  "type": "object",
  "required": ["displayName"],
  "properties": {
    "displayName":    { "type": "string" },                       // REQUIRED
    "url":            { "type": "string" },                       // optional
    "authorization":  { "type": "string" },
    "active":         { "type": "boolean", "default": false },
    "contactEmail":   { "type": "string" },
    "errorThreshold": { "type": "integer", "maximum": 20, "default": 3 },
    "integrationId":  { "type": "string", "format": "uuid" },
    "webhookTopics":  { "type": "array", "items": { "$ref": "#/components/schemas/AddWebhookTopic" }, "default": [] }
  }
}
```
Where `AddWebhookTopic` (`webhooks-api.json components.schemas.AddWebhookTopic`) requires both `topic: string` and `filters: Array<UpdateWebhookFilter>`.

Reconciliation: **wrong wire path AND wrong body** (case ≈ A+B+C):
- `displayName` is required by the spec; CLI never sends it. Surprising the command works at all today against the real API — most likely the `/v1/webhooks` path is being served by a legacy gateway that still accepts the older `{url, topics}` shape, which is why nobody has noticed.
- The CLI uses `topics: string[]`. Spec wants `webhookTopics: Array<{ topic, filters }>` — both the key name and the array element shape are different, and `filters` is required on each topic.
- The CLI doesn't expose `displayName`, `authorization`, `active`, `contactEmail`, `errorThreshold`, or `integrationId` at all on `create`.

**Recommendation.** Two compounding problems. First, fix the base URL (see "Sub-resource routing observations" below). Second, redesign `webhooks create` to match the spec: add a `--display-name` required flag, change `--topics` from `comma-separated-string` to a structured representation (or default each topic to `filters: []`), and surface the optional spec-side flags. Coordinate this with the read-path `WebhookSchema` (which already mirrors the spec's `displayName`, `errorThreshold`, etc., and uses `topics` as a synthesized string-array — see `packages/core/src/api/types.ts:479-507`, where the read schema diverges from the spec by parsing `topics: string[]` instead of `webhookTopics: Array<WebhookTopic>`). Likely needs an upstream verification call against staging — flag for confirmation, not silent fix.

---

### Operation: webhooks update

**Wire path.** CLI handler at `packages/cli/src/commands/webhooks/update.ts:170` calls `ctx.api.webhooks.updateConfiguration(id, data)`. `WebhooksApi.updateConfiguration` at `packages/core/src/api/webhooks.ts:51-60` issues `POST` to `/webhooks/${id}/configuration`. Resolved: `POST https://api.pax8.com/v1/webhooks/{id}/configuration`.

**Public spec location.** `webhooks-api.json paths."/webhooks/{id}/configuration".post` (`operationId: updateConfiguration`). Canonical resolved endpoint: `POST https://api.pax8.com/api/v2/webhooks/{id}/configuration`. CLI uses correct method, correct sub-resource path — **only the base-URL prefix is wrong**.

**Request body shape.** CLI sends a partial subset of:
```ts
// Zod input contract — packages/core/src/api/types.ts:529-535
UpdateWebhookConfigurationInputSchema = z.object({
  displayName:    z.string().min(1).optional(),
  url:            z.string().url().optional(),
  authorization:  z.string().optional(),
  contactEmail:   z.string().email().optional(),
  errorThreshold: z.number().int().min(1).max(20).optional(),
});
```
Spec body at `webhooks-api.json components.schemas.UpdateWebhookConfiguration` — same five properties (`displayName`, `url`, `authorization`, `contactEmail`, `errorThreshold`), all optional, with `errorThreshold` capped at 20. **Body shapes match exactly.**

**Required field coverage.** Spec marks no field as required on this endpoint. CLI enforces "at least one provided" client-side (`update.ts:111-124`) and fetches the current record before posting the diff (`update.ts:128-130`) — defensive merge isn't needed because the spec body shape is a partial.

**Reconciliation case.** **A** (wire path wrong: `/v1` vs `/api/v2` prefix). Body shape and method are clean.

**Recommendation.** Fix the base URL globally (see below); no other change required for this op.

**Latent foot-gun:** `WebhooksApi.update(id, data)` at `packages/core/src/api/webhooks.ts:36-39` still exists and would issue `PUT /webhooks/{id}` with an `UpdateWebhookInput` body — but the spec defines **no `PUT` (or `PATCH`) on `/webhooks/{id}`** (only `get` and `delete`; verified via `jq '.paths."/webhooks/{id}" | keys'` → `["delete","get"]`). Nothing in the CLI command tree calls `WebhooksApi.update` today, but the helper is exported on the public `@pax8/core` surface. Recommend deleting both `WebhooksApi.update` and `WebhooksApi.updateStatus` (the latter does `PATCH /webhooks/{id}` with `{status}` — also unsupported by the spec) along with their Zod schema `UpdateWebhookInputSchema` (`packages/core/src/api/types.ts:516-521`).

---

### Operation: webhooks enable

**Wire path.** CLI handler at `packages/cli/src/commands/webhooks/enable.ts:69` calls `ctx.api.webhooks.setStatus(id, true)`. `WebhooksApi.setStatus` at `packages/core/src/api/webhooks.ts:67-70` issues `POST` to `/webhooks/${id}/status`. Resolved: `POST https://api.pax8.com/v1/webhooks/{id}/status`.

**Public spec location.** `webhooks-api.json paths."/webhooks/{id}/status".post` (`operationId: updateStatus`). Canonical resolved endpoint: `POST https://api.pax8.com/api/v2/webhooks/{id}/status`. Method ✓, sub-resource path ✓, base prefix ✗.

**Request body shape.** CLI sends `{ active: true }` (literal at `webhooks.ts:68`). Spec body at `webhooks-api.json components.schemas.UpdateWebhookStatus`:
```json
{ "type": "object", "required": ["active"], "properties": { "active": { "type": "boolean" } } }
```
**Body matches exactly.**

**Reconciliation case.** **A** (wire path wrong: `/v1` vs `/api/v2`). Body, method, and required-field coverage are clean.

**Recommendation.** Fix the base URL globally; no other change.

---

### Operation: webhooks disable

**Wire path.** CLI handler at `packages/cli/src/commands/webhooks/disable.ts:70` calls `ctx.api.webhooks.setStatus(id, false)`. Same `WebhooksApi.setStatus` path as `enable`. Resolved: `POST https://api.pax8.com/v1/webhooks/{id}/status`.

**Public spec location.** Same as `enable` — `webhooks-api.json paths."/webhooks/{id}/status".post`.

**Request body shape.** CLI sends `{ active: false }`. Spec body `UpdateWebhookStatus` requires `{ active: boolean }`. **Body matches.**

**Reconciliation case.** **A** (wire path wrong: `/v1` vs `/api/v2`).

**Recommendation.** Same as `enable`.

---

### Operation: webhooks delete

**Wire path.** CLI handler at `packages/cli/src/commands/webhooks/delete.ts:56` calls `ctx.api.webhooks.delete(id)`. `WebhooksApi.delete` at `packages/core/src/api/webhooks.ts:72-74` issues `DELETE` to `/webhooks/${id}`. Resolved: `DELETE https://api.pax8.com/v1/webhooks/{id}`.

**Public spec location.** `webhooks-api.json paths."/webhooks/{id}".delete` (`operationId: Webhooks_delete`). Canonical resolved endpoint: `DELETE https://api.pax8.com/api/v2/webhooks/{id}`.

**Request body shape.** Empty body (`DELETE` with no payload). Spec defines no `requestBody` on this op — clean.

**Reconciliation case.** **A** (wire path wrong: `/v1` vs `/api/v2`).

**Recommendation.** Fix the base URL globally; no other change.

---

### Operation: webhooks logs retry

**Wire path.** CLI handler at `packages/cli/src/commands/webhooks/logs.ts:328` calls `ctx.api.webhooks.retryLog(webhookId, logId)`. `WebhooksApi.retryLog` at `packages/core/src/api/webhooks.ts:99-101` issues `POST` to `/webhooks/${id}/logs/${logId}/retry` with an empty `{}` body. Resolved: `POST https://api.pax8.com/v1/webhooks/{webhookId}/logs/{logId}/retry`.

**Public spec location.** `webhooks-api.json paths."/webhooks/{webhookId}/logs/{logId}/retry".post` (`operationId: retryWebhookDelivery`, tag `Webhook Logs`). Canonical resolved endpoint: `POST https://api.pax8.com/api/v2/webhooks/{webhookId}/logs/{logId}/retry`.

**Request body shape.** CLI sends `{}`. Spec defines no `requestBody` for this op (only path parameters `webhookId` and `logId`). Sending `{}` is harmless. Response is `202 Accepted` with no content.

**Reconciliation case.** **A** (wire path wrong: `/v1` vs `/api/v2`). Method, params, body all clean.

**Note on resolution path:** when the user invokes `pax8 webhooks logs retry <log-id>` without `--webhook`, the CLI walks `WebhooksApi.list()` → `getLogs(wh.id)` to find the owning webhook (`logs.ts:260-282`). Those are read-path calls — same `/v1` base-URL bug applies, but flagged separately as it affects every webhook read too.

**Recommendation.** Fix the base URL globally; no other change.

---

## Sub-resource routing observations

The CLI **does** use the spec's sub-resource structure correctly for `update` (→ `/configuration`), `enable`/`disable` (→ `/status`), and the retry endpoint. No "everything goes through one giant `PUT /webhooks/{id}`" anti-pattern in the live command tree — the routing is on the right shape, just at the wrong base URL.

However, the core API surface still carries two stale helpers that target endpoints **the spec does not document**:

- `WebhooksApi.update(id, data): client.put(/webhooks/${id}, data)` — `packages/core/src/api/webhooks.ts:36-39`. Spec has no `PUT /webhooks/{id}`.
- `WebhooksApi.updateStatus(id, status): client.patch(/webhooks/${id}, { status })` — `packages/core/src/api/webhooks.ts:41-44`. Spec has no `PATCH /webhooks/{id}`. Note also that this helper sends `{ status: string }` while the actual spec endpoint (`/status`, POST) wants `{ active: boolean }` — body shape mismatch on top of the wrong endpoint.

Neither is called from any CLI command, but they're exported on `@pax8/core` and would silently 404 (or worse, route to a legacy handler) for any embedded consumer who picks them up.

Sub-resources the spec defines but the CLI does **not** expose at all:
- `POST /webhooks/{id}/topics` (`addWebhookTopic`) — add a single topic to an existing webhook.
- `PUT /webhooks/{id}/topics` (`replaceWebhookTopics`) — replace the full topic list.
- `DELETE /webhooks/{id}/topics/{topicId}` — remove one topic.
- `PUT /webhooks/{id}/topics/{topicId}/configuration` — reconfigure a single topic's filters.
- `POST /webhooks/{id}/topics/{topic}/test` — topic-specific test ping (the `testTopic` core helper at `packages/core/src/api/webhooks.ts:87-92` knows about this but no CLI command surfaces it).

This is a feature-coverage gap, not a wire-mismatch — flagged for completeness but out of scope for "fix the writes that already exist."

The headline fix — pointing the webhooks calls at `https://api.pax8.com/api/v2` instead of `https://api.pax8.com/v1` — is **not** safely done at the `Pax8Client` level, because every non-webhooks API in the codebase (`companies`, `subscriptions`, `orders`, `invoices`, `products`, etc.) genuinely lives at `/v1`. The clean fix is per-API base override: either let `WebhooksApi` carry its own base URL, or refactor `Pax8Client` to accept a per-call `baseUrl` override the way it would for any other split-versioned API. The current single `FALLBACK_BASE_URL` + single-baseUrl client model cannot represent the actual deployment split.

## Constraints honored

- READ-ONLY: no source files modified outside of writing this report to `docs/triage/api-version-audit/`.
- All CLI claims cite file paths and line numbers in the worktree.
- All spec claims cite `webhooks-api.json` paths in the format `webhooks-api.json paths.X.method` or `components.schemas.Y`.
- Request bodies were verified against `paths.X.method.requestBody.content."application/json".schema` (resolving `$ref` into `components.schemas.*`) — not inferred from response schemas.
- No live API calls were made.
