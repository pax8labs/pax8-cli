---
"@pax8/cli": patch
"@pax8/core": patch
---

`pax8 products show <id> --provisioning` now hits the correct Pax8 endpoint and parses the response shape per the spec. Closes #443 (Candidate H from `docs/triage/v0.1.0-candidates.md`), surfaced by Fred Lintz's correction during domain review.

Three bugs fixed in lockstep — the half-implementation worked under `PAX8_DEMO=1` (the mock matched the hallucination) but would 404 against the real API and then throw a Zod parse error after the path:

1. **Endpoint path.** `/products/{id}/provisioning-details` → `/products/{id}/provision-details` (the Pax8 spec uses the singular form per `findProvisionDetailsByProductId`).
2. **Response shape.** The endpoint returns `{ content: ProvisioningDetail[] }` (envelope-wrapped array). `getProvisioningDetails` now returns `ProvisioningDetail[]`; `products show --provisioning --json` emits a top-level `provisioningDetails` array, not the previous single object.
3. **Schema.** Replaced the hallucinated `{ productId, vendorPrerequisites, fields[{ name, label, type, required, options }] }` with the spec shape: `{ key?, label?, description?, valueType?: "Input" | "Single-Value" | "Multi-Value", possibleValues?, values? }`. The schema is now shared with the `orders create` and `subscriptions update` write paths — same component on the wire, same shape in `@pax8/core`.

Mock fixtures (`packages/core/src/mock/mock-client.ts`) updated to the spec shape too, so `PAX8_DEMO=1` and the real API now exercise the same code path. **Breaking** to `provisioningDetails` JSON shape (was a single object with `productId/vendorPrerequisites/fields`; now a `ProvisioningDetail[]` array) — pre-publish, no deprecation owed.

Threading provision details into orders / subscriptions write paths per Fred's "safest bet is to always add provision details to each line item" guidance is tracked separately as Candidate H Option B.
