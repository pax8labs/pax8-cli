---
"@pax8/cli": patch
---

Third batch of #386 wire-level write coverage. Extends `e2e/integration/orders.integration.test.ts` with an `orders create --dry-run` test.

`--dry-run` maps to `isMock=true` on the wire — the server validates the order payload as if committing, then returns without creating a real order. Same wire-regression guard as the round-trip tests for webhooks (#539) and quotes (#540), but achieved without an inverse step because Pax8 supports `isMock` natively on the orders surface. No artifact in the sandbox, no cleanup, no sweep workflow needed.

The test asserts both the wire URL (`POST /v1/orders`) and that the request carried `?isMock=true` — so a future refactor that accidentally drops the dry-run threading would quietly start creating real orders against the sandbox, and this catch-it-at-the-belt-and-suspenders assertion ensures we notice immediately.

Three of four resources from #386's bullet list now covered (webhooks, quotes, orders). `subscriptions cancel` is the remaining holdout — it has no `isMock` equivalent and no inverse, so the next PR's approach is to gate it behind an explicit `PAX8_INTEGRATION_DESTRUCTIVE=1` env var (default off in PR CI; opt-in for nightly runs).
