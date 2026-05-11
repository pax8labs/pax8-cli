---
"@pax8/core": patch
---

Refactor: `OrderLineItemProvisioningDetailSchema` / `OrderLineItemProvisioningSchema` renamed to `LineItemProvisioningDetailSchema` / `LineItemProvisioningSchema` (and the type alias `OrderLineItemProvisioningDetail` to `LineItemProvisioningDetail`). The `Order` prefix was misleading once the schemas became shared across line-item domains — the public quoting OpenAPI spec's `AddStandardLineItemPayload.provisioningDetails` carries the same `Array<{key, values: string[]}>` shape as the orders side (#332).

Backward-compatible: the pre-#356 export names remain exported from `@pax8/core` as aliases that resolve to the same schema instances. Embedders that imported `OrderLineItemProvisioning*` continue to work unchanged; new code should prefer `LineItemProvisioning*`.

No wire-shape change. No CLI flag change. The quotes-side line-item path (`POST /v2/quotes/{id}/line-items` via `AddQuoteLineItemInputSchema`) doesn't currently surface `provisioningDetails`, and #356 doesn't add it — when a future PR adds a `--provisioning` flag for `quotes line-items add`, the field can reuse `LineItemProvisioningSchema.optional()` directly. Closes #356.
