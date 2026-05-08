# @pax8/cli

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

### Patch Changes

- [#274](https://github.com/pax8labs/pax8-cli/pull/274) [`b717681`](https://github.com/pax8labs/pax8-cli/commit/b71768166ca4e2dbaeefd5c9890ab60d779d9536) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 webhooks create`: renamed `--events` to `--topics` for consistency with the API field name (`webhookTopics`) and the CLI's own `Webhook.topics[]` output schema. `--events` is preserved as a deprecated alias that still functions identically but prints a one-line deprecation notice on stderr; it will be removed in v1.0. Passing both `--topics` and `--events` simultaneously is rejected with `ERROR_INVALID_INPUT`. No-change for scripts already calling `--events`; new scripts and docs should prefer `--topics`. Refs [#273](https://github.com/pax8labs/pax8-cli/issues/273).

- Updated dependencies [[`0b579bd`](https://github.com/pax8labs/pax8-cli/commit/0b579bd35c58db62bf038c9641b474eec3d9ce87), [`6f282fb`](https://github.com/pax8labs/pax8-cli/commit/6f282fb109fe91dffb1a7eeafa3a104d36b12e58)]:
  - @pax8/core@0.2.0
