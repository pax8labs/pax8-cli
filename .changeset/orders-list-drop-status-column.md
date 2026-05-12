---
"@pax8/cli": patch
---

`pax8 orders list` no longer renders an `Status` column in the default table output. Wire-level testing against the real Pax8 API on 2026-05-11 confirmed (a) the `Order` schema has no `status` field on `GET /orders` or `GET /orders/{id}`, and (b) the server silently ignores `?status=` (every value, including bogus ones like `NotAStatus`, returns the full unfiltered set). The column previously rendered a gray em-dash for every row against real prod data; the `--status` flag is retained as a documented no-op for backwards compatibility with partner scripts. Help text and the inline source comment now reflect the verified behavior, and `docs/triage/orders-status-server-behavior.md` captures the methodology. Tracking eventual API-side resolution in #369.
