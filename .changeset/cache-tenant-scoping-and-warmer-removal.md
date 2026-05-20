---
"@pax8/cli": patch
"@pax8/core": patch
---

Three interlocking fixes to the response-cache layer:

1. **Tenant + base-URL scoping.** `Pax8Client.buildCacheKey` previously keyed only on path / params / api / version, so a credential rotation or `PAX8_API_BASE` flip silently served tenant-A's cached responses into a tenant-B session for up to 24h (default TTL). Cache keys now include a SHA-256-truncated hash of `(clientId, PAX8_API_BASE env, baseUrl, apiBaseOverrides)`. **Upgrading invalidates existing on-disk cache entries** because the key prefix changes — first run after upgrade will be slower as the cache refills.

2. **Detached cache warmer removed.** `buildContext` was spawning three detached `pax8 list` child processes on every command run (companies / subscriptions / products) as a "warm the cache" optimization. Net effect was every invocation fanning into four processes, unnecessary API calls on commands that didn't need the data, and noise in `--quiet` mode process listings. Removed.

3. **`cache.enabled` / `cache.ttl_hours` honored.** The schema accepted these fields but `buildContext` never read them, so `cache.enabled: false` in `~/.pax8/config.yaml` still got the constructor's hard-coded 1h default. Now plumbed through end-to-end.

Closes #455, #466. Addresses #253.
