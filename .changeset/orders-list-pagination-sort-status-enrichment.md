---
"@pax8/cli": minor
"@pax8/core": minor
---

`pax8 orders list` now surfaces pagination, sorts newest-first by default, and resolves company names beyond the first 200 customers. Four sub-defects from #478 (repro: Cassie's 45,208-order partner portfolio) fixed in one PR.

- **Pagination is visible.** `--json` now wraps the result as `{ orders, page: { number, size, totalElements, totalPages } }` (1-based `number` matches the `--page` flag). The table footer shows `Page X of Y — N orders` plus an explicit `next: pax8 orders list --page <n+1>` hint when more pages exist (suppressed on the last page). `--with-actions` adds a `nextActions` entry pre-built with the next page's command. Pre-fix the JSON output was a flat array and the footer just said `45208 orders` with no page indicator — agents and partners had no signal that pagination existed.
- **Default sort is newest-first.** The CLI sends `?sort=createdAt,desc` by default; `--sort <field>` and `--order <asc|desc>` override. Pre-fix the CLI sent no sort hint and the real Pax8 API returned 2013-era archives in row 1 on long-lived tenants. `OrdersApi.list()` accepts the new `sort` parameter and forwards it on the wire.
- **`--status` flag removed.** Wire-level testing on 2026-05-11 (#369) confirmed the Pax8 server silently ignores `?status=` — every value, including bogus ones, returned the unfiltered set. The flag was previously kept as a documented no-op, but `pax8 orders list --status Completed | grep Completed` gave partners no way to know they were looking at unfiltered data. The flag is removed entirely; Commander emits `unknown option --status` and exits 1. We'll re-add it when the platform ships real status filtering (#369).
- **Company column populates beyond row 200.** The CLI pages through `companies.list` until every `companyId` referenced by the orders page is covered (capped at 10 pages of 1000 to bound the loop). When a partner has more customers than the cap can cover, a single stderr warning explains the placeholder rather than leaving silent blanks. Pre-fix the CLI fetched only the first 200 companies, so partners with >200 customers saw blank `Company` cells on most rows.

Demo mode (`MockPax8Client`) honors the new `sort` parameter so `PAX8_DEMO=1` exercises the same code path as the real wire. The `OrdersResource.list` mock continues to filter on the dropped `status` param for backwards compatibility with any in-tree fixtures that still pass it, but no command code now sends it.

Closes #478.
