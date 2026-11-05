---
"@pax8/core": minor
"@pax8/cli": minor
---

Fix `pax8 usage list` and `pax8 usage show` against the live Pax8 API. Both previously failed with `ERROR_API_VALIDATION` on every real subscription: the usage schemas were modeled on demo data and never matched the wire shape.

- Paginated responses that omit `content` (the API's shape for an empty page) now parse as an empty list instead of failing validation.
- Breaking (`@pax8/core`): `UsageSummary` now mirrors the live shape — `resourceGroup`, `vendorName`, `currencyCode`, `currentCharges`, `partnerTotal`, `isTrial` — and drops `date`, `quantity`, `unitPrice`, and `subtotal`, which the API never returns at summary level. `UsageLine` is now one product's usage for one day (`usageDate`, `productName`, `unitOfMeasure`, `quantity`, `unitPrice`, `currentCharges`, `currentProfit`, `partnerTotal`, `currencyCode`) with no `id` / `usageSummaryId`. `UsageApi.listLines` now requires `{ usageDate: "YYYY-MM-DD" }`, which the API mandates.
- `pax8 usage show --lines` shows one day's lines (today by default); the new `--date YYYY-MM-DD` picks the day and implies `--lines`.
- `pax8 usage list --month` is now ignored with a stderr warning: summaries are current-billing-period rollups and carry no date.
- Usage tables show company and product names (resolved from their IDs), resource group, charges, and partner total, with per-currency totals.
- Demo mode now parses usage fixtures through the same schemas as the live client, so fixture drift fails in CI instead of only in production.
