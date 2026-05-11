---
"@pax8/core": patch
"@pax8/cli": patch
---

Fix: `OrderLineItemInputSchema.provisioningDetails` (and the wire-read `OrderLineItemSchema.provisioningDetails`) reshaped from `Record<string, unknown>` to `Array<{key: string, values: string[]}>` to match the public Pax8 OpenAPI spec's `ProvisioningDetail` schema. No CLI command was populating this field at the time of the fix, so no live traffic was breaking — but the wrong shape was baked into the Zod input contract and would have produced unparseable bodies for any future provisioning-aware feature.

The new shape is exposed as `OrderLineItemProvisioningDetailSchema` (single entry) and `OrderLineItemProvisioningSchema` (array). The product-side `ProvisioningDetailSchema` (which describes a *product's* provisioning requirements, not an order line's *values*) is unchanged.

`pax8 orders create` gains a `provisioning=<key>:<value>[|<value>...]` syntax inside `--line-item`, repeatable for multiple keys: `--line-item product=<id>,quantity=5,provisioning=domain:contoso.com,provisioning=region:us-east|us-west`. The mock client echoes `provisioningDetails` back on dry-run responses so subprocess tests can pin the wire shape. Closes #332.
