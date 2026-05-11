---
"@pax8/cli": patch
---

Fix: align `--status` help text on every `list` command with the public Pax8 OpenAPI. `pax8 orders list --status` used to advertise `Completed, Processing, Failed, PendingManual` as if they were a documented enum, but the spec's `Order` schema has no `status` field and `GET /orders` declares no `status` query parameter. The flag is kept (partner scripts that rely on it still work), but the help text now disclaims the spec gap and points to `docs/triage/api-version-audit/orders-status-enum.md`. `pax8 subscriptions list --status` and `pax8 invoices list --status` had similar but smaller defects (subsets of the spec enum with an "...etc." escape hatch); their help text now mirrors the full documented enum. `pax8 companies list --status` and `pax8 quotes list --status` were already correct; both have regression-guard tests added. Closes #250.

Wire behavior is unchanged on every command. Only `--help` strings and tests.
