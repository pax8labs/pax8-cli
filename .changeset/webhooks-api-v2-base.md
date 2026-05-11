---
"@pax8/core": patch
---

Fix every webhook call to land at `https://api.pax8.com/api/v2/webhooks/...` per the public webhooks OpenAPI spec. Previously every webhook call resolved to `https://api.pax8.com/v1/webhooks/...`, which the spec does not document — six write operations (`create`, `updateConfiguration`, `setStatus`, `delete`, `test`/`testTopic`, `retryLog`) plus every webhook read were either 404ing or hitting a legacy alias whose behavior is unverified.

`WebhooksApi` now threads `{ api: "webhooks" }` on every request, opting into the per-API base URL mechanism added in #321. The CLI's `Pax8Client` construction (`packages/cli/src/lib/context.ts`) registers `webhooks → https://api.pax8.com/api/v2` in `apiBaseOverrides`; embedded `@pax8/core` consumers who construct their own client need to add the same entry to route webhook calls correctly. Relative paths inside `WebhooksApi` are unchanged (`/webhooks`, `/webhooks/{id}/status`, etc.) — they were already correct per the spec.

Also removes two dead helpers (`WebhooksApi.update`, `WebhooksApi.updateStatus`) and the `UpdateWebhookInputSchema` they used. Both targeted endpoints the spec does not document (`PUT /webhooks/{id}`, `PATCH /webhooks/{id}`) and would 404 against the real API. The CLI's `pax8 webhooks update` command was already using `updateConfiguration` instead, so no command-surface changes.

Body shapes for the write endpoints are tracked separately under #323 and are intentionally not addressed in this hotfix — this is wire-path only.
