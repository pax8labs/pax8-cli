---
"@pax8/core": minor
"@pax8/cli": minor
---

`pax8 quotes show` now surfaces server-side totals from the v2 quoting API's `QuoteResponse.totals` object. Splits one-time charges (`Total (initial)`) from per-period subscription charges (`Total (recurring)`) — each shown with currency code. Zero-bucket lines are suppressed so a recurring-only quote shows only the recurring line and an initial-only quote shows only the initial line. When the API omits totals (defensive against API drift; the spec marks the field required), render falls back to the locally-summed sum of line-item subtotals — preserves the pre-change behavior for older API responses.

`@pax8/core` exports two new schemas / inferred types: `AmountCurrencySchema` / `AmountCurrency` and `InvoiceTotalsSchema` / `InvoiceTotals`. `QuoteSchema` and `QuoteLineItemSchema` both gain optional `totals: InvoiceTotalsSchema` fields. Optional (not required) so a partial / drifted API response doesn't fail the whole quote parse — render layer handles the absent case explicitly. JSON output passes the `totals` shape through unchanged from the wire (no transformation), so agents can read `totals.initialCost`, `totals.initialProfit`, `totals.initialTotal`, `totals.recurringCost`, `totals.recurringProfit`, `totals.recurringTotal` directly.
