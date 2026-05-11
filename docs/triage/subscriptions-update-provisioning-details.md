# Subscriptions `update` — missing `provisioningDetails` surface

> **⚠️ Historical record — superseded.** This triage doc captured the v0.1 scoping of #363 ("file a CLI fix"). Subsequent Rovo-grounded internal research reversed that direction: #363 has been **closed and deferred to v0.2** as **#368**. This doc is retained as a historical artifact; do not act on its recommendations for v0.1.

---

**Status:** ~~Real CLI fix needed.~~ Superseded — see #368.

**Context:** Fred Lintz flagged a gap in the subscription update surface during pre-publish review. The OpenAPI spec documents `provisioningDetails` as a write-only field on `PUT /subscriptions/{subscriptionId}` (request body only, not returned on GET). The CLI's `subscriptions update` command does not expose this field. This is the subscriptions-side analogue of issue #332 (orders line-item provisioning details).

---

## 1. What does the CLI do today?

The CLI's `subscriptions update` command accepts only `--quantity` and `--billing-term` flags. The request body is constructed at `packages/cli/src/commands/subscriptions/update.ts:196-220`, which copies only these two fields from user options into the `updateData` object. There is no `--provisioning` flag and no code path to populate `provisioningDetails` in the request body.

**Citation:** `packages/cli/src/commands/subscriptions/update.ts:196-220`.

---

## 2. What does the spec say?

The Pax8 OpenAPI spec documents `provisioningDetails` as a field on the `Subscription` schema with `writeOnly: true` (accepted on request bodies, not returned on reads). It is an optional array of provisioning-detail objects, each with the shape `{ key: string, values: string[] }`. The spec permits `provisioningDetails` to be included alongside any of the mandatory update fields (`quantity`, `billingTerm`, `price`, or `startDate`). The field is **not required** — it is an optional companion to the mandatory at-least-one-of rule.

**Spec location:** `https://devx.pax8.com/openapi/partner-endpoints.json`

**JSON path:**
```
paths./subscriptions/{subscriptionId}.put.requestBody.content.application/json.schema.allOf[0].properties.provisioningDetails
```

**Spec excerpt:**
```json
"provisioningDetails": {
  "writeOnly": true,
  "type": "array",
  "items": { "$ref": "#/components/schemas/ProvisioningDetail" }
}
```

**ProvisioningDetail schema:**
```json
{
  "type": "object",
  "properties": {
    "key": { "type": "string" },
    "values": { "type": "array", "items": { "type": "string" } },
    "label": { "type": "string", "readOnly": true },
    "description": { "type": "string", "readOnly": true },
    "valueType": { "type": "string", "readOnly": true },
    "possibleValues": { "type": "array", "items": { "type": "string" }, "readOnly": true }
  }
}
```

---

## 3. Is there a CLI fix to file, or close #363 as no-op?

**File CLI fix.** The OpenAPI spec explicitly documents `provisioningDetails` on the subscription update request body. The field is optional but should be exposed as a `--provisioning` flag (or similar) to allow partners to update provisioning details alongside quantity or billing-term changes. Without it, partners who need to update provisioning are blocked and must use the web portal or a different API client. This is a real capability gap.

---

## 4. What should the doc/help-text say?

The `--provisioning` flag (or equivalent) should document that it accepts provisioning details in the form `key:value[|value...]` and is repeatable (just as #351 landed for `pax8 orders create --line-item`). The help text should clarify that provisioning details are optional and can accompany any quantity or billing-term update. The spec does not require provisioning details on subscription updates, but some products or vendors may expect them when other fields are modified.

---

## 5. Appendix: Full quotes and citations

### CLI code (update.ts:196-220)

```typescript
const updateData: Record<string, unknown> = {};

if (options.quantity !== undefined) {
  let newQty = parseInt(options.quantity, 10);

  // Confirm quantity change (with option to adjust)
  const confirmedQty = await confirmWithChange(
    newQty < sub.quantity
      ? `Reduce from ${formatQuantity(sub.quantity)} to ${formatQuantity(newQty)}?`
      : `Update from ${formatQuantity(sub.quantity)} to ${formatQuantity(newQty)}?`,
    newQty,
    { label: "New quantity" },
  );
  if (confirmedQty === null) {
    process.stderr.write(chalk.yellow("\n  Update cancelled.\n\n"));
    return;
  }
  newQty = confirmedQty;

  updateData.quantity = newQty;
}

if (options.billingTerm) {
  updateData.billingTerm = options.billingTerm;
}
```

**File:** `packages/cli/src/commands/subscriptions/update.ts:196-220`

---

### Current `UpdateSubscriptionInputSchema` (types.ts:454-458)

```typescript
export const UpdateSubscriptionInputSchema = z.object({
  quantity: z.number().int().min(1).optional(),
  billingTerm: BillingTermSchema.optional(),
});
export type UpdateSubscriptionInput = z.infer<typeof UpdateSubscriptionInputSchema>;
```

**File:** `packages/core/src/api/types.ts:454-458`

**Note:** This schema needs to grow `provisioningDetails: OrderLineItemProvisioningSchema.optional()` to match the spec.

---

### Reusable provisioning schema (types.ts:306-318)

```typescript
/**
 * Wire shape for `OrderLineItem.provisioningDetails` — an array of
 * `{ key, values[] }` objects per the spec. See #332.
 */
export const OrderLineItemProvisioningDetailSchema = z.object({
  key: z.string(),
  values: z.array(z.string()),
});
export type OrderLineItemProvisioningDetail = z.infer<typeof OrderLineItemProvisioningDetailSchema>;

export const OrderLineItemProvisioningSchema = z.array(
  OrderLineItemProvisioningDetailSchema,
);
```

**File:** `packages/core/src/api/types.ts:306-318`

**Note:** This schema is currently named with the `OrderLineItem` prefix but is suitable for reuse on the subscription write surface. Issue #359 proposes a rename to the neutral `LineItemProvisioning*Schema` for clarity, but the existing `OrderLineItemProvisioningSchema` can be reused immediately (mild naming smell, no public-API churn).

---

### API audit conclusion (api-version-audit/subscriptions.md:70-73)

The existing `docs/triage/api-version-audit/subscriptions.md` audited the subscription update endpoint and concluded it is **wire-clean and body-clean** for the currently exposed `quantity` and `billingTerm` fields. However, that audit did not flag the missing `provisioningDetails` because no `--provisioning` flag existed then to check. The spec explicitly supports the field; the audit's scope was limited to what the CLI surfaced at the time.

---

### Issue #363 statement

The GitHub issue #363 contains the full spec evidence and proposed fix patterns. The issue was filed after Fred Lintz's pre-publish reviewer feedback and confirmed via manual inspection of `partner-endpoints.json`. The issue is a direct parallel to #332 (orders line-item provisioning), which landed in PR #351.

---

## Scope

This triage does **not** require:

- Changes to the `SubscriptionSchema` read shape (the spec's `writeOnly: true` annotation means GET responses do not carry the field).
- Changes to commitment-aware pre-flight logic (`update.ts:135-194`). Provisioning-detail updates are not governed by commitment-term restrictions.
- API-side changes. The API already accepts and documents the field.

This triage **does** require:

1. Expand `UpdateSubscriptionInputSchema` to include `provisioningDetails: OrderLineItemProvisioningSchema.optional()`.
2. Add a `--provisioning` flag to `pax8 subscriptions update` mirroring the parser from #351.
3. Update the command help text and examples.
4. Update the mock client to echo `provisioningDetails` on subscription updates for subprocess test verification.
5. File a follow-up PR to rename `OrderLineItemProvisioning*Schema` → `LineItemProvisioning*Schema` (suggest as optional cleanup, separate from this fix).
