---
"@pax8/core": minor
"@pax8/cli": minor
---

Send a `User-Agent` on every Pax8 API request, including the OAuth token exchange: `pax8labs-cli/<version> pax8labs-core node/<version> (<platform>)`. Requests previously went out as Node's default `node`, so Pax8's API logs couldn't attribute CLI traffic — and a third-party tool's hard-coded `pax8-cli/1.0.0` was mistaken for this CLI. The `pax8labs-` prefix avoids that collision.

`@pax8/core`: new `setUserAgentProduct("name/version")` lets embedders name themselves (otherwise core sends `pax8labs-core node/... (...)`); `getUserAgent()` returns the header value.
