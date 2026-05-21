---
"@pax8/cli": patch
---

First batch of #386 wire-level write coverage. Adds `e2e/integration/webhooks.integration.test.ts` with two tests:

1. A read smoke (`webhooks list --json`) pinning the resolved URL to the documented `/api/v2/webhooks` path — same regression-class guard as the companies / quotes / orders smokes.
2. A write round-trip (`webhooks create` → `webhooks delete`) that creates a webhook against a non-routable RFC-6761 `https://example.invalid/...` callback URL, captures the new ID from the create envelope, then immediately fires a delete. No artifacts left in the sandbox tenant on success; on partial failure the worst case is a single dangling row pointing at a non-routable URL that a manual sweep can pick up.

Webhooks was chosen as the safest first write target because: full CRUD exists in the CLI, no billing/order/customer side effects, and the callback URL fixture means nothing on the partner side ever actually fires.

Doesn't fully close #386 — that issue asks for write coverage across at least four resources plus a documented cleanup strategy. Subsequent PRs will follow this pattern for quotes (create + delete), and document cleanup expectations for resources without an inverse operation (orders, subscriptions cancel) in CONTRIBUTING.md.

`integration.yml` still runs with `continue-on-error: true`. Promotion to a required gate is a separate decision once the suite has more breadth.
