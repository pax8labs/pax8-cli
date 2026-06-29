---
"@pax8/cli": patch
"@pax8/core": patch
---

Persist the OAuth access token across CLI invocations.

`TokenManager` now hydrates from `<configDir>/.token-cache.json` (mode 0600, O_NOFOLLOW) before hitting `POST /v1/token`, so the typical `pax8 <command>` no longer pays ~100-300ms of auth latency or burns rate-limit budget on every shell. Cache identity is keyed by `sha256(clientId)` + `sha256(apiBaseUrl)` — switching `PAX8_API_BASE` between prod/staging, or running `pax8 auth login` with new creds, automatically invalidates without leaking either value on disk. TTL honors the auth server's `expires_in` (production: 86400s); refresh skew is `max(1s, min(60s, 10% of TTL))`.

Behavioral shifts worth noting for callers and operators:

- **Cross-process token reuse.** Scripts that loop over multiple `pax8` commands now share the token across processes instead of fetching one per invocation. Integrations or tests assuming "one /token mint per call" will observe different behavior.
- **`Pax8Client` retries once on 401.** On a 401, the cache is cleared and a fresh token is fetched, then the request retries once. Misconfigured-auth cases incur two failed calls before surfacing, but server-side token revocations now recover automatically instead of hanging the CLI for up to 24h.
- **Stronger `auth logout`.** `CredentialStore.clearCredentials()` now also wipes `<configDir>/.token-cache.json`, so logout invalidates the cached token across any in-flight shells.
- **`clearToken()` vs `clearCache()`.** `clearToken()` only clears in-memory state; the new `clearCache()` performs the full wipe (memory + disk). Callers that previously assumed `clearToken()` meant "full revocation" should switch to `clearCache()`.
- **New optional embedder hook.** `TokenManagerLike.clearCache?: () => void` — invoked exactly once by `Pax8Client` on a 401. Embedders that bring their own token manager don't need to implement it; the optional-chaining call is a no-op.
- **`pax8 doctor`** now reports token-cache file permissions alongside the existing credentials.json check.

The cache file uses the same OS-level hardening as `credentials.json`. No new dependencies. Token TTL is clamped to 24h on the way in (defense-in-depth against a misbehaving auth endpoint).

Closes #233.
