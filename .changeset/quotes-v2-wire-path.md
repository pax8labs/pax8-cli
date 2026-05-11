---
"@pax8/core": patch
"@pax8/cli": patch
---

Fix: `pax8 quotes` and `pax8 quotes line-items` commands now hit the correct v2 wire path. Previously every quote request resolved to `https://api.pax8.com/v1/quotes/...`, which the public Pax8 API does not document — quotes live only at `/v2/quotes/...` per the quoting OpenAPI spec (v2.0.0). The CLI's quote commands returned 404 against the real API.

Wire path only: this hotfix routes the requests to the right URL. Five read operations (`quotes list/show/delete`, `quotes line-items list/remove`) now work end-to-end against the real v2 API. Five write operations (`quotes create/update/send`, `quotes line-items add`) still fail until follow-up body-shape fixes land — but they now fail visibly with 4xx body-shape errors instead of silent 404s. The body-shape work is tracked under the `quotes-v2-body-shape` label and held until integration test coverage exists (#308). See `docs/triage/quotes-api-version.md` for the full audit, including the retrospective on why the initial wire-path audit didn't catch the body-shape problems.

`Pax8Client` gains a `RequestOpts` per-call parameter on `get`/`post`/`put`/`patch`/`delete`/`getPaginated`, currently used only to opt into a non-default API version (`{ apiVersion: "v2" }`). Other API classes are unchanged and continue to inherit the default `/v1` from the shared base URL.
