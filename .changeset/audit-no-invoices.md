---
"@pax8/cli": patch
---

`invoices audit` no longer reports every active subscription as `missing` when nothing in the portfolio has been invoiced for the period yet. On a live tenant with no invoices it returned 497 under-billing findings. It now warns that the subscriptions were not reconciled, which is what `pax8 today` already does. A company-scoped audit still reports `missing` rows when that company has no invoice but the rest of the portfolio does. `missing` rows now also carry the company name; live subscriptions only have `companyId`, so these rows used to show a blank company.
