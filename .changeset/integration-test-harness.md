---
"@pax8/cli": patch
"@pax8/core": patch
---

Add wire-level integration test harness (#308) that hits the real Pax8 API and asserts every CLI call resolves to the URL documented by the relevant OpenAPI spec. Runs via `pnpm test:integration` and skips cleanly when `PAX8_CLIENT_ID` / `PAX8_CLIENT_SECRET` are absent — the default `pnpm test` never depends on credentials. Seed coverage hits one v1 resource (`companies list`) and one v2 resource (`quotes list`), proving both routing surfaces work against the real API.

This closes the structural test gap that allowed the #307 quotes `v1`/`v2` regression to ship: unit tests mocked the client and only asserted relative paths; subprocess tests ran in demo mode against `MockPax8Client`. The new harness is the missing wire-level layer, with a documented extension pattern (`e2e/integration/harness.ts`, `CONTRIBUTING.md`) so any new API surface plugs in with one read-only smoke test. The harness unblocks the held quotes-v2 body-shape fixes (#311–#314 and the parallel audit's #323/#325/#326/#327/#328/#329/#331/#332).

`@pax8/core` change: `Pax8Client` debug mode now also emits the resolved absolute URL alongside the existing relative-path log line, e.g. `[pax8] GET url=https://api.pax8.com/v2/quotes?page=0&size=50`. This is what the integration harness parses to verify version routing. Query strings carry no bearer tokens.
