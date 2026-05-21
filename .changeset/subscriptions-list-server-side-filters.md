---
"@pax8/cli": minor
"@pax8/core": minor
---

`pax8 subscriptions list` now exposes the server-side `billingTerm`, `productId`, and `sort` filters the public OpenAPI has always supported. Closes #398.

Three new flags, additive — every existing invocation still works unchanged:

- `--billing-term <Monthly|Annual|2-Year|3-Year|One-Time|Trial|Activation>` — fails fast on typos before any network call, same vocabulary as `--status` (#408).
- `--product <productId>` — passes through to the wire as `?productId=…`. UUID expected; no fuzzy product-name resolution here because the typical use case is `subscriptions list --product <copy-pasted-id-from-a-prior-row>`.
- `--sort <field>` / `--sort <field>:<direction>` — accepts `quantity`, `startDate`, `endDate`, `createdAt`. Ascending by default; append `:desc` for descending. The user-facing separator is `:` (not `,`) to avoid shell-quoting surprises; the CLI rewrites it to the wire's `field,direction` form before forwarding.

Pre-fix, partners with large portfolios had to download a full subscriptions list and filter client-side — even though the OpenAPI spec defined these parameters. `MockPax8Client.SubscriptionsResource.list` mirrors the server-side filtering for every new parameter so `PAX8_DEMO=1` exercises the same code path as the real API.

`@pax8/core`'s `SubscriptionsApi.list` signature gains the three new optional fields. Type-safe additive change; consumers that don't pass the new fields are unaffected.
