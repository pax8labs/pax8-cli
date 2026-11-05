---
"@pax8/core": minor
"@pax8/cli": minor
---

Fix `pax8 orders list` and `pax8 doctor` against the live Pax8 API.

- `pax8 orders list` failed with `ERROR_INTERNAL` (500) on every call: the default sort was sent as `sort=createdAt,desc`, which the API rejects with an immediate 500. `OrdersApi.list` now rewrites the canonical `createdAt` to the wire name `createdDate` (other fields pass through).
- `GET /orders` takes ~30s server-side even at `size=1` on large tenants, just past the 30s default timeout, so calls timed out and retried for ~2 minutes. `orders list` and `dashboard` now allow `/orders` 90s (unless `PAX8_TIMEOUT_MS` is set).
- `pax8 doctor` no longer appears to hang: its API probes are single attempts capped at 15s, and a probe that only timed out is reported as slow (`⚠ Orders slower than 15s`) instead of failing the check.

`@pax8/core`: `Pax8ClientOptions.maxRetries` (default 3), per-request `RequestOpts.timeoutMs`, `OrdersApi.list(params, opts?)`, and new `toWireSort`, `ordersListRequestOpts`, `ORDERS_LIST_TIMEOUT_MS` exports.
