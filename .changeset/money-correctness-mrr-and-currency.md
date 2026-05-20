---
"@pax8/cli": patch
"@pax8/core": patch
---

Two interlocking money-correctness fixes that both inflated and mislabeled partner-cost numbers across dashboard, recommendations, cost-sim, and reports.

**Breaking-feeling change for some users:** monthly-cost aggregates will drop for any partner whose portfolio includes `One-Time`, `Trial`, or `Activation` line items. The pre-fix code returned `price × quantity` (gross) for these terms, which inflated every "monthly Pax8 cost" and "potential uplift" figure that aggregates `subscriptionMrr()`. These terms are not recurring revenue and now correctly contribute **0** to monthly aggregates. The drop is the *correct* number — but it is a visible delta day-over-day, so partners reviewing dashboards after upgrade should expect their headline number to reset.

Specifics:

1. **`subscriptionMrr()` per-term divisor table.** Replaced the previous switch with a `Record<BillingTerm | "1-Year", number>` divisor table. `Monthly`, `Annual` (and the defensive `"1-Year"` alias used by `commitment.term`), `2-Year`, `3-Year` divide normally; `One-Time`, `Trial`, `Activation` contribute 0. Unknown enum values now contribute 0 and emit a one-shot stderr warning per process per unknown value — a future Pax8 enum addition surfaces instead of silently miscounting.

2. **`formatCurrency()` honors `currencyCode`.** The previous implementation hard-coded `"$"`, so every EUR / GBP / CAD partner saw their subscriptions, dashboard, top customers, recommendations, and cost-sim output mislabeled as USD. The `subscriptions list` table had a workaround that appended `" EUR"` per row; that suffix is dropped here and the formatter is the single source of truth via `Intl.NumberFormat`. Falls back to a numeric + code-suffix render when ICU rejects a code. `cost sim` now threads the matched current subscription's currency through to output.

New demo fixtures (`demo-data.ts`) provide regression gates: Coastline's One-Time EUR onboarding fee (zero-MRR + non-USD), Bright Minds' Trial Defender seat (zero-MRR), Acme's GBP Entra ID P2 (non-USD rendering).

Closes #465, #472.
