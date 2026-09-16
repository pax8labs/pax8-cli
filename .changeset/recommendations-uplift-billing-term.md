---
"@pax8/cli": patch
---

fix(recommendations): don't amortize One-Time SKUs as recurring uplift (#710), and give the onboarding fixture its own product (#707)

`estimatedMrrUplift` was computed as `price × seats` at all three call sites in the recommendations engine, with `billingTerm` never entering the calculation. `productPriceMap` held bare numbers, so the term was discarded at lookup time. A €5,000 One-Time onboarding SKU across 39 seats therefore reported **$195,000/mo of recurring uplift**, and `dashboard.potentialMonthlyUplift` came out at $204,445 against a portfolio whose total monthly cost is $1,760.41 — 116× the entire book.

The shared `subscriptionMrr()` helper already handles this correctly (`One-Time` / `Trial` / `Activation` contribute 0, fixed in #465) and its docstring calls itself "the single source of truth for MRR calculation across the codebase." That wasn't true: the engine imported it for *current* MRR and bypassed it for *uplift*. All three uplift sites now route through it, and `productPriceMap` carries the billing term alongside the price.

Portfolio uplift on the demo fixture drops from $204,445 to $9,445.

Note the One-Time recommendation now reports `estimatedMrrUplift: 0`, which is correct for a field named MRR but leaves a real one-time opportunity showing no value. Representing that properly needs a separate non-recurring field; out of scope here.

---

Separately, `sub-coastline-onboarding-004` carried `productId: "prod-m365-e3-0003"` — Microsoft 365 E3 — while its `productName` said "M365 onboarding & migration (one-time)". `findSeatGaps` takes both from the same row, so the resulting recommendation suggested onboarding while its `orderArgs` named E3, a product the customer already held 40 seats of. Since `orderCommand` renders a product ID rather than a name, neither an agent nor a partner could spot it in a preview.

The row borrowed E3's id because the fixture's `ProductPricing.billingTerm` was typed `"Monthly" | "Annual"`, so a One-Time professional-services SKU couldn't be expressed in the catalog at all. That type now accepts the full `BillingTermSchema` union, the SKU has its own `prod-m365-onboarding-0011` entry, and the subscription points at it.

Two adjacent fixture inconsistencies surfaced and are fixed with it: the trial subscription's `productName` carried a "— trial" suffix that disagreed with the catalog (trial-ness is already in `billingTerm: "Trial"`, and nothing keys off the name), and the onboarding SKU is renamed to the "Microsoft …" prefix every other Microsoft product in the catalog uses.

A contract test now asserts that every recommendation's `orderArgs --product` resolves to a catalog product whose name equals `suggestedProducts[0]`, so a future productId/productName disagreement fails CI instead of surfacing as an agent placing the wrong order.
