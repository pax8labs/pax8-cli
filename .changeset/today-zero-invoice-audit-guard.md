---
"@pax8/cli": patch
---

fix(today): don't report phantom undercharges when a tenant has no invoices (#705)

`auditInvoices` counts an active subscription with no matching invoice line as a `missing` discrepancy, signed negative so it surfaces as an undercharge. Correct per line — but it means an empty invoice-item set turns *every* active subscription into a finding. A live tenant with 476 active subscriptions and zero invoices produced 681 discrepancies and a `dollarsOnTable` of $950,640, led by "$662,640.00 undercharge on Dynamics 365…". Nothing was under-billed; nothing had been billed at all.

`pax8 invoices audit` already guarded this case and correctly reported nothing for the same tenant in the same minute. `pax8 today` did not — and `today` is the command the agent contract tells assistants to run first and lead with, so an agent would confidently report six figures that don't exist.

Any partner whose invoices haven't posted yet is affected: a new partner, the start of a billing cycle, a sandbox tenant. Demo mode was never affected (its fixture has invoices).

The audit now short-circuits before `buildAuditItems`, so the phantom rows reach neither the item list nor `dollarsOnTable` / `monthlyImpact`. This is distinct from the fetch-failure path, which still emits the existing "audit findings suppressed" warning.
