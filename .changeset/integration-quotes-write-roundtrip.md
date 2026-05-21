---
"@pax8/cli": patch
---

Second batch of #386 wire-level write coverage. Extends `e2e/integration/quotes.integration.test.ts` with a `quotes create` → `quotes delete` round-trip that follows the pattern proven in #539's webhooks test.

Resource picked for the same reasons as webhooks: full CRUD exists in the CLI, draft-state creates are non-binding (no `quotes send`, so the customer never sees anything), and `--product` is optional so the test can fire the smallest possible write that exercises `POST /v2/quotes`. The test fetches the first row from `companies list --json` rather than hard-coding a company ID, so it runs against any sandbox tenant that has at least one company on file.

Still does not close #386 — that asks for write coverage on at least four resources (orders create, quotes create + send, subscriptions cancel, webhooks create + enable/disable) plus a documented cleanup strategy. Webhooks (#539) and quotes (this PR) are the two resources with full CRUD; the remaining two (orders, subscriptions) lack an inverse operation and need a separate cleanup story before they can land.
