---
"@pax8/cli": minor
"@pax8/core": minor
---

Expose every server-side list filter the OpenAPI spec already supports on the `quotes`, `clients`/`companies`, and `invoices` list endpoints. Three related fix-before-launch findings from the partner-readiness audit (`docs/triage/partner-readiness-audit/01-api-conformity-reads.md`) — the spec defined the filters, but the CLI either filtered client-side (quotes) or omitted the parameters entirely (companies, invoices), forcing partners with large portfolios to download full lists before filtering locally.

- `pax8 quotes list --status` is now server-side and accepts the full 9-value v2 enum (`draft | assigned | sent | closed | declined | accepted | changes_requested | expired | pending`). Closes #387.
- `pax8 clients list` (and `pax8 companies list`) now expose `--city` / `--state` / `--country` / `--zip`, `--self-service` / `--bill-on-behalf` / `--order-approval`, and `--sort <name|city|country|state|zip>`. The CLI vocabulary maps `--state` → `stateOrProvince` and `--zip` → `postalCode` per the existing convention documented for `companies create` (#327/#328). The generic `filter` parameter on `CompaniesApi.list` (no OpenAPI backing) is dropped — no deprecation since the package is pre-v0.1.0. Closes #388.
- `pax8 invoices list` now exposes `--from` / `--to` (mapping to `invoiceDateRangeStart` / `invoiceDateRangeEnd`) and `--sort` with the full spec enum (`invoice-date | due-date | status | partner-name | total | balance | carried-balance`). The kebab-cased flag values map onto the wire's camelCase. Closes #389.

All three are additive — existing invocations without the new flags continue to work unchanged. `MockPax8Client` mirrors the server-side filtering for every new parameter so `PAX8_DEMO=1` exercises the same code path as the real API.
