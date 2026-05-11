---
"@pax8/core": patch
"@pax8/cli": patch
---

Fix: `pax8 subscriptions cancel --cancel-date` now sends the `cancelDate` query parameter as RFC 3339 / ISO 8601 `date-time` (`YYYY-MM-DDT00:00:00Z`) to match the Pax8 OpenAPI spec, which types the parameter as `format: date-time`. Previously the CLI sent the date-only form `YYYY-MM-DD` — most APIs accept that leniently, but the contract mismatch was unverified and would have surprised partners reading the spec.

User-facing behavior is unchanged: the `--cancel-date` flag still accepts (and only accepts) the simple `YYYY-MM-DD` form, and `--json` output still emits `cancelDate` as `YYYY-MM-DD`. The normalization happens inside `SubscriptionsApi.delete()` just before the wire call, mirroring the defensive `effectiveDate` normalization landed for `quotes line-items add` in #312. Closes #333.
