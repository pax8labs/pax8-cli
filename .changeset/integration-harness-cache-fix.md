---
"@pax8/core": patch
---

`FileCache` now honors `PAX8_CONFIG_DIR` (via `getConfigDir()`) instead of hardcoding `~/.pax8/cache`. The hardcoded path meant any caller that used the documented `PAX8_CONFIG_DIR` escape hatch got an inconsistent cache root, and the integration test harness in particular was unable to isolate per-worker caches — a `[pax8] CACHE HIT` from a previous test served stale data on rerun.

Behavior change is purely additive: if you don't set `PAX8_CONFIG_DIR`, `getConfigDir()` still returns `~/.pax8`, so the cache stays at `~/.pax8/cache`. Callers passing an explicit `cacheDir` to the `FileCache` constructor are unaffected.

Also adds `e2e/integration/orders.integration.test.ts` (orders v1 smoke + the `--status` no-op pin per #369) and updates the harness to (a) force `PAX8_DEMO=false` so a developer's `demo: true` config can't false-green integration runs, and (b) point each worker at a throwaway `PAX8_CONFIG_DIR` so the cache fix actually isolates per-worker.
