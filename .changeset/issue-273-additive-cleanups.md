---
"@pax8/cli": minor
"@pax8/core": minor
---

**Schema additions and a small dropped field.**

- `Product.vendor` (duplicate of `vendorName`) removed — only `vendorName` remains, matching the public API. Demo data and consumers updated.
- `Company.externalId` surfaced — partner-side identifier returned by the API. Available in `pax8 companies show` (table + `--json`).
- `Subscription.currencyCode` surfaced — ISO-4217 currency code returned by the API. Available in `pax8 subscriptions list/show` `--json` output; appended to the price column in table view only when the value is non-`USD`.
- Inline documentation block added on `SubscriptionSchema` clarifying the intentional ergonomic split between the canonical nested `commitment` (alias for the API's `commitmentTerm`) and the flattened top-level `commitmentTermEndDate`. No behavior change.

Closes #273.
