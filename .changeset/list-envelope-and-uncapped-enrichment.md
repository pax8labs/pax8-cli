---
"@pax8/cli": minor
---

**Breaking** (`--json` shape across every list command, pre-publish): every `--json` list command now emits a wrapped envelope `{ <resource>: [...], page: { number, size, totalElements, totalPages } }` instead of a flat array. Per #370 the package isn't published yet, so no deprecation cycle is owed; consumers switch `JSON.parse(out)` → `JSON.parse(out).<resource>`. Closes #483.

Ports the pattern proven in #478 (orders list) across the remaining list surface — `subscriptions list`, `clients list`, `invoices list`, `invoices items`, `quotes list`, `contacts list`, `products list`, `products search`, `usage list`, `webhooks list`, `webhooks logs`, `webhooks topics list`, `subscriptions renewals`. `recommendations list` was already wrapped as `{ recommendations, totalAvailable }` per #521 and is left untouched. Endpoints without server-side pagination (webhooks, usage, products search, renewals) get a `singlePageEnvelope(rowCount)` synthesized so the shape stays consistent.

`page.number` is 1-based — matches what the user would pass as `--page` next. Compare `<resource>.length` to `page.totalElements` to detect pagination. With `--with-actions`, a `nextActions` array is added (including a next-page entry when more pages exist). Table footers consolidated onto a single format: `Page N of M — K records — next: pax8 <cmd> --page N+1 …` (suppressed on the last page; suppressed entirely on empty result sets so the empty-state message stands alone).

**Uncapped name enrichment.** `companies.list({ size: 200 })` callsites in `subscriptions list`, `subscriptions renewals`, and `recommendations list` replaced with `buildCompanyNameMap` / `fetchAllCompanies` from `lib/enrich-subscriptions.ts`. Pre-fix, partners with >200 customers saw blank Company cells in those views; post-fix the helper pages through `companies.list` until every referenced ID is resolved or a 10×1000 guardrail trips. Remaining 200-cap sites (dashboard, recommendations/act, recommendations/upsell, report/*) are tracked for follow-up — each carries its own product semantics worth a focused PR.

Helpers exposed for future list commands: `buildPageEnvelope(wirePage)`, `renderPaginationFooter(env, opts)`, `buildNextPageAction(env, cmd, resource)`, `singlePageEnvelope(rowCount)`, `buildCompanyNameMap(ctx, rows, opts)`, `fetchAllCompanies(ctx)`. `CLAUDE.md` and `docs/UX_GUIDE.md` §6 updated to document the envelope contract as a stable agent-facing surface.
