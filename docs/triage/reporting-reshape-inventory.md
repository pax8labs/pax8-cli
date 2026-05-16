# Reporting / metrics surface inventory

Companion document to the `feat/reporting-reshape` PR. Captures every
existing reporting / metrics primitive in the codebase before the three
new `pax8 report *` commands land, so reuse decisions are explicit and
the v0.2 backlog has a clean reference.

Scope: post-#440 (removal of `report mrr` / `report growth` + vocabulary
alignment) and post-#439 (2-Year / 3-Year `BillingTerm` normalization
fix). Both PRs are already merged on `main`; this PR builds on top.

---

## 1. `pax8 report *` command surface

After #440 the `report/` directory was deleted entirely — parent command
file, the two subcommand files (`mrr.ts`, `growth.ts`), and the
subprocess test (`packages/cli/src/__tests__/report.test.ts`) all
removed. `pax8 report` is **not registered** in
`packages/cli/src/index.ts` today.

This PR recreates `packages/cli/src/commands/report/index.ts` as a thin
parent that registers three subcommands (`renewals`, `concentration`,
`subscriptions`) and re-registers the parent in the root command file.

---

## 2. Renewal-tracking logic — reused by `report renewals`

**Service:** `packages/core/src/services/renewal-tracker.ts`

- `getUpcomingRenewals(subscriptions, withinDays): RenewalReport`
  - Filters subscriptions by `commitmentTermEndDate` (or
    `commitment.endDate` fallback) within the requested window.
  - Skips subs with no commitment date (counted in
    `RenewalReport.skippedNoDate`) — these are month-to-month and never
    "renew" in the commitment sense.
  - Per-row monthly cost is computed via `subscriptionMrr` from
    `analytics.ts` (now correct for all `BillingTerm` enum values
    post-#439).
- `RenewalReport` shape:
  - `items[]` (sorted by urgency, soonest first)
  - `totalMrrRenewing` / `totalArrRenewing` (canonical, #298)
  - `totalMrrAtRisk` / `totalArrAtRisk` (deprecated aliases — one cycle)
  - `annualCount`, `monthlyCount`, `urgentCount` (<= 14d),
    `skippedNoDate`
- `RenewalItem` shape (per row):
  - `subscriptionId`, `companyId`, `companyName`, `productName`,
    `quantity`, `renewalDate` (Date), `billingTerm`, `price`,
    `mrrRenewing` + deprecated `mrrAtRisk`, `arrRenewing` + deprecated
    `arrAtRisk`, `daysUntilRenewal`.
  - Notably **does not** carry `vendorName` — the existing surface only
    needs product names. The new `report renewals` command adds vendor
    via the `enrich-subscriptions` pattern.

**CLI consumers today:**

- `packages/cli/src/commands/subscriptions/renewals.ts` — primary
  user-facing wrapper. Accepts `--within <Nd>` (period string parser),
  `--company`, `--with-actions`. Emits flat array OR
  `{ renewals, nextActions }` envelope depending on `--with-actions`.
  Carries the standardized disclaimer footer.
- `packages/cli/src/commands/dashboard.ts` — calls `getUpcomingRenewals`
  with a hard-coded 30-day window for the dashboard alerts/quick-action
  block.

**Reuse decision for `report renewals`:**

Call `getUpcomingRenewals` directly. Wrap the output in the new JSON
shape (per-row `monthlyCost` as `AmountCurrency`, top-level
`totalMonthlyCostExposure` as `AmountCurrency`, add `vendorName` via
products enrichment, surface `commitmentTermEndDate` + `daysUntilEnd`
instead of `renewalDate` + `daysUntilRenewal`). Do NOT alter
`RenewalItem` itself — the subscriptions wrapper still emits the legacy
`mrrRenewing` / `mrrAtRisk` shape and that's correct for that command.
The new report command is a fresh surface with the post-#440 envelope
shape.

---

## 3. Analytics primitives — reused by `report concentration` and `report subscriptions`

**Service:** `packages/core/src/services/analytics.ts`

- `subscriptionMrr(price, quantity, billingTerm): number` — single
  source of truth for per-sub monthly cost.
  - **#439 fix:** This function is now correct for **every value** in
    the `BillingTermSchema` enum (`Monthly`, `Annual`, `2-Year`,
    `3-Year`, `One-Time`, `Trial`, `Activation`). The 2-Year and 3-Year
    cases divide by 24 / 36 respectively; previously these fell through
    to the unknown-term default and were treated as `price x quantity`,
    silently 24x / 36x overstating their monthly cost.
  - `One-Time` / `Trial` / `Activation` still return `price x quantity`
    by design (they aren't really recurring; reframing them is a
    separate question).
  - Unknown / falsy terms preserve the historical default of
    `price x quantity`.
- `computeMrr(subscriptions): MrrReport` — aggregator. Filters to
  Active subs, groups by company / product / vendor, sums per-sub
  monthly cost.
- `computeGrowth(invoices, months): GrowthReport` — month-over-month
  delta on invoice totals. **Not used by any CLI command after #440.**
  Retained in `@pax8/core` for v0.2 reporting reuse.
- `MrrReport` / `GrowthReport` types — exported but post-#440 not
  consumed by CLI commands (only by `report mrr` / `report growth`,
  both deleted).

**Reuse decision:**

- `report concentration` and `report subscriptions` call
  `subscriptionMrr` directly per sub (not `computeMrr`). The grouping
  semantics required are slightly different per command (concentration
  needs share-percent + cumulative; subscriptions needs counts +
  totalQuantity + annualCost), and re-rolling the per-sub fold is
  cheaper than adapting `MrrReport`.
- `computeMrr` / `computeGrowth` / `MrrReport` / `GrowthReport` stay
  exported as-is from `@pax8/core`. v0.2 will revisit.

---

## 4. Cost simulation — unaffected, noted for completeness

**Service:** `packages/core/src/services/cost-simulator.ts`

- `simulateCostChange(...): SimulationResult` — `pax8 cost sim` backend.
  Reuses `subscriptionMrr` for the per-sub monthly cost leg.
- Shape is different from the new reporting commands (per-scenario
  before/after, not per-entity rollup). No reuse opportunity for the
  three new commands.

---

## 5. Invoice auditing — unaffected, noted for completeness

**Service:** `packages/core/src/services/invoice-auditor.ts`

- `auditInvoices(...): AuditReport` — `pax8 invoices audit` backend.
  Compares per-invoice line items against active subscriptions and
  surfaces overcharge / undercharge / unexpected discrepancies.
- Per-invoice findings (`AuditReport.invoices[].discrepancies[]`) —
  very different shape from the three new commands' per-entity rollup.
- Noted because Bret Pittenger's canon-alignment work also touched this
  surface and future invoice-line-item-based reporting (the `report
  invoiced` / `report recurring` shapes from Candidate F) will likely
  reuse the auditor's line-item correlation logic.

---

## 6. Recommendations — unaffected, noted for completeness

**Service:** `packages/core/src/services/recommendations.ts`

- `getRecommendations(...)`, `getPortfolioCoverage(...)`,
  `findUpsellCohort(...)` — backends for `pax8 recommendations
  list / act / upsell`.
- All three reuse `subscriptionMrr` for `estimatedMrrUplift` (which is
  partner-cost uplift, not partner-side resale revenue — Bret's review
  flagged this terminology, hence #440 added explicit "Pax8 cost uplift"
  language in the dashboard / recommendations help and JSON
  descriptions).

No direct reuse for the three new report commands.

---

## 7. Dashboard rollups — pattern reference for the new commands

**Command:** `packages/cli/src/commands/dashboard.ts`

Post-#440 `dashboard` emits `AmountCurrency` envelopes for every
currency-bearing top-level field:

- `monthlyCost` / `annualCost` — portfolio totals.
- `topCustomers[].monthlyCost` — per-customer breakdown (top 5 by Pax8
  monthly cost — same pattern `report concentration --by customer`
  generalizes).
- `potentialMonthlyUplift` — high-priority recommendation uplift.

Currency-resolution rule: read from
`activeSubs.find((s) => s.currencyCode)?.currencyCode ?? "USD"`. The new
report commands follow the same convention. Mixed-currency portfolios
are out of scope for v0.x.

The dashboard also locks in the wire-side `mrrRenewing` / `mrrAtRisk`
preservation rule — those fields are partner-side risk-framing on
`RenewalReport`, not CLI-aggregated Pax8 cost, so they stay flat numbers
(not wrapped in `AmountCurrency`). `report renewals` follows the same
rule for its per-row `monthlyCost`: wrap aggregations in
`AmountCurrency` envelopes, leave wire-side risk-framing fields flat.

---

## 8. Standardized disclaimer footer

The exact string, applied verbatim via `.addHelpText("after", ...)`:

```
Note: Numbers shown are Pax8 cost — what Pax8 charges you. For partner revenue (what you charge your customers), combine with sell-through pricing from your PSA.
```

Footer is currently enforced on:

- `pax8 dashboard`
- `pax8 recommendations list / act / upsell`
- `pax8 subscriptions renewals`
- `pax8 clients more` (and the `companies more` alias)

The three new commands in this PR (`report renewals`, `report
concentration`, `report subscriptions`) extend the matrix to nine
surfaces. The regression test in
`packages/cli/src/__tests__/help-json-output.test.ts` already gates the
existing seven; `report.test.ts` (recreated in this PR) gates the new
three.

---

## 9. Deferred to v0.2

Invoice-line-item-based reporting (Candidate F: `report invoiced` /
`report recurring`) is **explicitly out of scope** for this PR. Gating
questions surfaced in Bret Pittenger's canon-alignment work:

- **Bucket-key choice** — `invoiceDate` (when Pax8 invoiced the
  partner) versus `startPeriod` (the period the line was attributable
  to). Pax8's canonical warehouse rolls by `startPeriod` with billing-
  period amortization, which the CLI can't replicate from the public
  API alone.
- **Recurring filter** — Pax8's canon defines recurring by the
  underlying product *type*, not by billing-term flags reachable from
  the public API. The CLI can approximate (filter out `One-Time` /
  `Activation` terms) but can't reach the canonical answer.

Once those calls are made (likely in a v0.2 design doc with Bret),
`report invoiced` and `report recurring` land. Until then,
`@pax8/core`'s `computeMrr` / `computeGrowth` and the `invoice-auditor`
service are the durable building blocks — the analytics engine stays;
the CLI surface evolves.
