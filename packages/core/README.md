# @pax8/core

Computed business logic for Pax8 marketplace operations — renewal tracking, invoice audit, upsell recommendations, and MRR analytics. Interface-agnostic: the same package powers [`pax8-cli`](https://github.com/pax8labs/pax8-cli), and is usable from a portal feature, a web dashboard, a Lambda, or any Node.js context. The Pax8 API is a CRUD layer; this package is what turns raw subscriptions, invoices, and products into the answers MSPs actually ask for.

## Install

```bash
pnpm add @pax8/core
# or: npm install @pax8/core
# or: yarn add @pax8/core
```

Requires Node.js 20+. ESM only.

## Quick example

Compute upcoming renewals and total estimated MRR at risk for the next 30 days:

```ts
import { Pax8Client, getUpcomingRenewals } from "@pax8/core";

const client = new Pax8Client({
  clientId: process.env.PAX8_CLIENT_ID!,
  clientSecret: process.env.PAX8_CLIENT_SECRET!,
});

const subscriptions = await client.subscriptions.listAll({ status: "Active" });
const companies = await client.companies.listAll();
const companyNameById = new Map(companies.map((c) => [c.id, c.name]));

const report = getUpcomingRenewals(subscriptions, companyNameById, {
  withinDays: 30,
});

console.log(`${report.items.length} renewals, $${report.totalMrrRenewing.toFixed(2)} estimated MRR renewing in window`);
for (const item of report.items.slice(0, 5)) {
  console.log(`  ${item.companyName} — ${item.productName} in ${item.daysUntilRenewal}d`);
}
```

Demo mode (no credentials):

```ts
import { MockPax8Client, getUpcomingRenewals } from "@pax8/core";

const client = new MockPax8Client();
const subscriptions = await client.subscriptions.listAll();
// ...same shape as above
```

## What's in here

The durable asset — questions this package answers without you having to assemble them from raw API calls:

- **Renewal tracker** (`getUpcomingRenewals`) — which subscriptions renew within N days, how much estimated MRR is at risk, sorted by urgency. The Pax8 API has no renewals endpoint; this parses commitment dates and computes the report.
- **Invoice auditor** (`auditInvoices`) — cross-references invoice line items against active subscriptions to flag overcharges, undercharges, and orphan line items with dollar impact.
- **Recommendation engine** (`getRecommendations`, `getPortfolioCoverage`) — analyzes each customer's stack against backup / security / identity / productivity categories, identifies gaps, estimates MRR uplift, and emits ready-to-execute order parameters.
- **MRR analytics** (`subscriptionMrr`, `computeMrr`, `computeGrowth`) — per-subscription MRR with annual-to-monthly amortization; aggregation by company/product/vendor; growth deltas across snapshots.
- **API client** (`Pax8Client`) — typed wrapper over Pax8 v1 with auth, retry, and rate-limit awareness. Sub-clients: `companies`, `contacts`, `subscriptions`, `orders`, `invoices`, `products`, `usage`, `quotes`, `webhooks`.
- **Mock client** (`MockPax8Client`) — drop-in replacement backed by an in-memory fixture. Same interface as `Pax8Client`. Used by the CLI for `PAX8_DEMO=1`.
- **Bulk executor** (`executeBulk`) — concurrency-bounded batch runner with progress callbacks, used to apply a list of operations (e.g. ordering across many companies) without overwhelming the API rate limit.
- **Types and Zod schemas** — `Subscription`, `Company`, `Invoice`, `Product`, `Order`, etc., plus typed errors (`ApiError`, `AuthError`, `RateLimitError`, `NotFoundError`, `ValidationError`) and machine-readable error codes (`ERROR_AUTH_EXPIRED`, `ERROR_COMPANY_NOT_FOUND`, etc., as a `Pax8ErrorCode` union).

## Versioning

**Experimental.** This package is currently `0.x` and the public surface may change between minor versions. Pin a specific version (`"@pax8/core": "0.1.0"`, not `"^0.1.0"`) until the package reaches `1.0`. Breaking changes will be called out in release notes.

The CLI in this repo is the reference consumer — if you're unsure how to assemble a workflow, look at how [`packages/cli`](https://github.com/pax8labs/pax8-cli/tree/main/packages/cli/src/commands) uses these services.

## License

Apache-2.0
