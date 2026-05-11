---
"@pax8/core": patch
---

Add a per-API base URL mechanism to `Pax8Client`. Each API class can now opt into a different base URL than the project-wide default by registering a key in `apiBaseOverrides` at construction time and passing `{ api: "<key>" }` in `RequestOpts`. This unblocks APIs that live on a different prefix entirely (e.g. Webhooks at `https://api.pax8.com/api/v2/...` — the per-call `apiVersion` substitution from #316 can swap version segments but cannot represent a different prefix).

Three composition dimensions now compose cleanly:

1. **Project-wide default** — `https://api.pax8.com/v1` (today's `FALLBACK_BASE_URL`); overridable via `PAX8_API_BASE` for staging.
2. **Per-API override** — registered in `apiBaseOverrides`, opt-in per call via `RequestOpts.api`. Unaffected by `PAX8_API_BASE` so the staging-redirect pattern continues to work for the default base.
3. **Per-call version segment** — existing `RequestOpts.apiVersion` from #316; applies on top of whichever base was selected.

No wire behavior changes today for any existing API class. `QuotesApi` continues to use the per-call `apiVersion: "v2"` mechanism unchanged. `WebhooksApi` adoption ships separately under #322.
