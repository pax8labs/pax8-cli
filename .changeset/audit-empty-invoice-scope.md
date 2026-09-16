---
"@pax8/cli": patch
---

fix(audit): report findings when a scope has active subscriptions but no invoices (#709)

**`invoices audit` returned a clean bill of health for any scope holding active subscriptions and no invoice.** It short-circuited on an empty invoice-item list and rendered a green checkmark *before the auditor ran*, discarding an already-fetched, already-company-filtered subscription list. The audit was effectively invoice-first: a company with no invoice had nothing to filter to and fell through to success.

```console
$ pax8 invoices audit --company "Acme Corp"
  ✓ No invoices found for current period.

$ pax8 invoices audit --json | jq '[.discrepancies[]|select(.companyName=="Acme Corp")]|length'
5
```

Acme Corp is the largest gap in the demo fixture — 25 seats across 5 products, none invoiced — and it read as clean when audited directly. On the large fixture (1,000 companies, 5,000 active subscriptions, 0 invoices) the entire portfolio audited clean with `itemsAudited: 0`, output byte-identical to "audited everything, found nothing". `auditInvoices()` already handled an empty invoice list correctly — every unmatched active subscription becomes a `missing` discrepancy — so the fix is to stop discarding the subscriptions and let it run. A company-scoped audit now agrees row-for-row with the unscoped audit filtered to that company.

**Only the current period can be reconciled, and `--month` now says so instead of guessing.** `invoices.list` is month-filtered but the subscription fetch is not: `subscriptions.streamAll()` returns what is active *right now* and carries no history. A past month is missing subscriptions cancelled since; a future month has not happened. Emitting `missing` rows for either would invent findings for subscriptions that did not exist in the audited period, and emitting a checkmark would repeat the false all-clear. Both non-current cases now report an explicit unreconciled warning naming how many subscriptions went unchecked, with the reason matched to the direction. The warning goes to **stderr**, so `--json | jq` pipelines are unaffected and the documented envelope shape is unchanged.

Note that `itemsAudited: 0` still cannot be distinguished from "audited, all clean" by a `--json` consumer — the warning addresses the human case only. That half of #709 remains open.
