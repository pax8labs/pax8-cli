# @pax8/core

## 0.2.0

### Minor Changes

- [#277](https://github.com/pax8labs/pax8-cli/pull/277) [`0b579bd`](https://github.com/pax8labs/pax8-cli/commit/0b579bd35c58db62bf038c9641b474eec3d9ce87) Thanks [@jidulberger](https://github.com/jidulberger)! - **Schema additions and a small dropped field.**
  - `Product.vendor` (duplicate of `vendorName`) removed — only `vendorName` remains, matching the public API. Demo data and consumers updated.
  - `Company.externalId` surfaced — partner-side identifier returned by the API. Available in `pax8 companies show` (table + `--json`).
  - `Subscription.currencyCode` surfaced — ISO-4217 currency code returned by the API. Available in `pax8 subscriptions list/show` `--json` output; appended to the price column in table view only when the value is non-`USD`.
  - Inline documentation block added on `SubscriptionSchema` clarifying the intentional ergonomic split between the canonical nested `commitment` (alias for the API's `commitmentTerm`) and the flattened top-level `commitmentTermEndDate`. No behavior change.

  Closes [#273](https://github.com/pax8labs/pax8-cli/issues/273).

- [#275](https://github.com/pax8labs/pax8-cli/pull/275) [`6f282fb`](https://github.com/pax8labs/pax8-cli/commit/6f282fb109fe91dffb1a7eeafa3a104d36b12e58) Thanks [@jidulberger](https://github.com/jidulberger)! - **Breaking (`--json` consumers): Field naming aligned with the public Pax8 API.**
  - `InvoiceItem.subtotal` → `subTotal`
  - `InvoiceItem.unitPrice` → `price`
  - `Company.modified` → `updatedDate`
  - `Quote.expirationDate` → `expiresOn`
  - `Quote.createdDate` → `createdOn`

  Acceptable while pre-1.0; the CLI now uses API field names directly so partners reading both surfaces don't have to translate. The `--expiration-date` CLI flag on `pax8 quotes create` and `pax8 quotes update` is unchanged — flag vocabulary and field vocabulary are intentionally separate concerns. (refs [#273](https://github.com/pax8labs/pax8-cli/issues/273))
