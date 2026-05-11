---
"@pax8/core": minor
"@pax8/cli": minor
---

**Recommendations (additive):** `pax8 recommendations` output now carries an `opportunityType` field alongside the existing `type`, using Pax8's canonical Opportunity Explorer 5-type taxonomy (`Upsell`, `Cross-sell`, `Add-on`, `Upgrade`, `Net-new`). Existing `type` field unchanged.

Mapping:

| Existing `type`              | Emitted `opportunityType` |
|------------------------------|---------------------------|
| `cross_sell` (active subs)   | `Cross-sell`              |
| `cross_sell` (zero-sub cust) | `Net-new`                 |
| `seat_gap`                   | `Upsell`                  |

Zero-subscription companies now classify as `Net-new` instead of being silently routed through the `Cross-sell` rail — the closest existing surrogate for OE's `Net-new` motion, and the fix for surprise #7 in `docs/triage/recommendations-conformance.md`.

Added `pax8 recommendations upsell --from-product <name> --to-product <name>` following the MCP "Proactive Upsell Opportunity Finder" composition pattern (Guide §3b): list every company on the source product who does not yet have the upsell target, with seats, current MRR, and contact details (`--with-contacts`). New exports from `@pax8/core`: `findUpsellCohort`, types `UpsellMatch`, `UpsellCohortReport`, `OpportunityType`.

Full taxonomy alignment — retiring the CLI's security-centric 7-category product taxonomy in favor of Pax8's canonical STAX/PCM categories, and migrating `seat_gap` with an alias period — is deferred to v0.2 (#375), to align with whatever taxonomy OE's `GET /opportunities` API publishes when ARC-785 ships.

Extends the disclosure-over-rewrite pattern from #298 (vocabulary alignment) and #299 (`mrrAtRisk` → `mrrRenewing` one-cycle alias). Cites Rovo research on PICS (4 executive categories) / STAX (8 L1 operational categories) / Taxonomy v2 (in flight, hierarchical L1/L2/L3) in the new STAX-divergence doc comment at the top of `packages/core/src/services/recommendations.ts` and in the v0.2 issue (#375).
