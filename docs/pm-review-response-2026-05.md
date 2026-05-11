# pax8-cli API Contract Review Detail — 2026-05

**Status:** All four reviewer concerns code-resolved. One additional security finding surfaced by the broader audit and also shipped. Ready for PM sign-off.

**Reviewer feedback received:** 2026-05-08, on the Subscriptions section of the CLI domain review.

**This document:** packages the resolution to each concern, the Pax8-internal research grounding (Atlassian Rovo across Confluence, Jira, and authoritative team docs), the PRs shipped, and what remains open for PM input vs. what's already settled.

---

## TL;DR

| Reviewer concern | Resolution | PR | Status |
|---|---|---|---|
| 1. `subscriptions list/show` — see exactly what's returned | Field-tier audit against the [Marketplace & Platform Data Risk Tiering v1.0](https://pax8.atlassian.net/wiki/spaces/PS1/pages/2748907531/Marketplace+Platform+Data+Risk+Tiering) standard; every exposed field is Tier 2 (transaction) or Tier 4 (UUID/catalog). Already-hidden Tier 1 fields (`partnerCost`, `wholesaleBuyRate`, margin) correctly hidden. | n/a — audit only | ✓ Confirmed safe to ship as-is |
| 2. `subscriptions update` needs more consideration / commitment limitations | Pre-flight detects active commitment; blocks restricted changes with actionable recovery steps. Vendor-specific rules NOT decoded (CLI surfaces commitment context generically; portal handles vendor exceptions). | [#296](https://github.com/pax8labs/pax8-cli/pull/296) | ✓ Shipped |
| 3. `subscriptions cancel` commitment limitations | Commitment-aware preview, safe-path default (schedule for commitment term end date), `--immediately` flag for explicit cancel-today. Vocabulary discipline regression-tested — no "ETF" / "penalty" / "fee" framing. | [#302](https://github.com/pax8labs/pax8-cli/pull/302) | ✓ Shipped |
| 4. Renewals MRR conversion is weird / better ways to answer "what is at risk?" | Added `arrAtRisk` companion field; later renamed `mrrAtRisk` → `mrrRenewing` to avoid conflation with Pax8's patent-filed Revenue at Risk Predictor (different concept, same words). Canonical MRR/ARR definitions added to help text + README. | [#297](https://github.com/pax8labs/pax8-cli/pull/297) + [#299](https://github.com/pax8labs/pax8-cli/pull/299) | ✓ Shipped |
| Bonus: webhook `secret` exposed Tier 0 (surfaced by broader audit) | Redacted on read paths; displayed once on create; aggregation-principle note added to SECURITY.md. | [#301](https://github.com/pax8labs/pax8-cli/pull/301) | ✓ Shipped |

**Open for PM input:** very little — mostly process items (named peer reviewer, npm OIDC config, public org decision), plus one optional vocabulary call (`mrrAtRisk` deprecated alias retention period). Section 6 below.

---

## 1. `subscriptions list/show` — field exposure audit

### Reviewer feedback (verbatim)

> "I think we'd be mostly good with subscriptions list and subscriptions show <id> but I would want to see exactly what is being returned to make sure it [is] clear and revealing things we don't want to show."

### What we did

Pax8-internal field-tier audit against the [Marketplace & Platform Data Risk Tiering v1.0 (FINAL, Matt Dunham / PlatSec)](https://pax8.atlassian.net/wiki/spaces/PS1/pages/2748907531/Marketplace+Platform+Data+Risk+Tiering) standard.

### What `pax8 subscriptions show <id> --json` exposes (post-#297/#299)

```json
{
  "id": "sub-summit-m365bp-001",
  "companyId": "a1b2c3d4-…",
  "productId": "prod-m365-biz-prem-0001",
  "productName": "Microsoft 365 Business Premium [New Commerce Experience]",
  "quantity": 85,
  "startDate": "2025-03-26",
  "createdDate": "2025-03-20",
  "billingStart": "2025-03-26",
  "status": "Active",
  "price": 22,
  "currencyCode": "USD",
  "billingTerm": "Annual",
  "commitment": { "id": "cterm-…", "term": "1-Year", "endDate": "2026-05-11" },
  "commitmentTermEndDate": "2026-05-11",
  "provisioningStatus": "Provisioned",
  "companyName": "Summit Healthcare Partners"
}
```

### Per-field tier classification

Every field is Tier 2 (transaction data the partner already has) or Tier 4 (UUIDs, public catalog data). No Tier 1 (Revenue/Competitive — vendor cost, margin, billing engine internals) exposure.

Specific call-outs:
- **`commitment.id`** (UUID) — Tier 2. Partners need this UUID for `orders create` on products requiring commitment. UUID form doesn't leak pricing tiers (was historically a sequential integer pre-migration per [QUOTE-91](https://pax8.atlassian.net/browse/QUOTE-91), deliberately migrated to UUID for opacity).
- **`provisioningStatus`** — Tier 2 at the granularity the public API returns. Internal pipeline states (`setProvisionTaskStatus`, RAP states, ServiceNow case statuses) are deliberately kept on `p8p` internal routes and NOT exposed via the public API. Help text was clarified in #299: *"Reflects the subscription's current provisioning state, not internal task-level detail."*
- **`price`** — Tier 2. Maps to `partnerBuyRate` per [PSAI-987](https://pax8.atlassian.net/wiki/spaces/DDS/pages/1687257272/PSAI-987+Investigate+p8p.subscription) (what the partner pays Pax8, which they already see on every invoice). NOT `wholesaleBuyRate` (Tier 1, hidden), NOT `partnerCost` (Tier 1, hidden).

Already-correctly-hidden fields per existing review choices: `partnerCost`, `vendorSubscriptionId`, `parentSubscriptionId`, `updatedDate`. Per Josh Hollander's inline comment, `originalSubscriptionId` should never see the light of day — and it doesn't (was never in the CLI surface).

**The exclusion is now CI-enforced.** `packages/core/src/api/types.test.ts` walks every exported Zod schema (top-level + nested through optional / nullable / default / array / union wrappers) and asserts that none of the permanently-excluded field names — `originalSubscriptionId`, `parentSubscriptionId`, `vendorSubscriptionId`, `partnerCost`, `wholesaleBuyRate`, `costTotal`, `billingFee` — appear. A future PR that introduces one fails the test suite with a clear message naming the field and the schema it appeared in. The forbidden list is policy-as-code with inline justifications per field; adding more requires explicit security review.

### Aggregation principle

The Tiering doc's [Aggregation Principle](https://pax8.atlassian.net/wiki/spaces/PS1/pages/2748907531/Marketplace+Platform+Data+Risk+Tiering) notes that bulk export of individually-low-tier records can compose a higher-tier dataset. For the CLI, this is enforced server-side: the OAuth2 client-credentials flow scopes access to a single partner, so a partner aggregating their own subscriptions is the inherent design. Bulk-iteration is noted in SECURITY.md (added in #301) for downstream-handling awareness (logs, scripts, monitoring tools).

### Conclusion

**No action required.** Ship as-is.

---

## 2. `subscriptions update` — commitment limitations

### Reviewer feedback (verbatim)

> "subscriptions update <id> is going to need a lot more consideration to be useful and has a lot of limitations due to commitments"

### What we did

Pax8-internal Rovo research across the API reference, NCE FAQ, AOS-G order rules, vendor integration pages, the [Marketplace API Reference PDF](https://pax8.atlassian.net/wiki/pages/viewpageattachments.action?pageId=504332368&preview=%2F504332368%2F504594490%2FPax8+API+Reference.pdf), [PFR-86](https://pax8.atlassian.net/browse/PFR-86), and 60+ supporting docs.

### Key findings

- **PFR-86 documents $250K+ in credits from failed billing-term changes at renewal** — this isn't a UX nicety, it's a real business case for the pre-flight check.
- **Mutability rules:**
  - Quantity INCREASES — allowed mid-commitment (with vendor-specific cancel windows; e.g., NCE 7-day window per [IPS FAQ](https://pax8.atlassian.net/wiki/spaces/IPS/pages/1551990798/FAQ))
  - Quantity DECREASES — NOT permitted mid-commitment, hard rule across Microsoft NCE / Google annual / others
  - Billing-term CHANGES mid-commitment — effectively impossible; the only documented path is cancel-and-reorder
  - Commitment-term changes — admin-only via internal VPM functions, not partner-facing
  - Price — locked for the commitment term
- **Scheduled changes API** — does not exist. No `--at-renewal` parameter the CLI could meaningfully map to.
- **Error shape** — flat `{ errors: [string] }`, no codes; pattern-matching is fragile.
- **Restriction reasons** — scattered across internal-only VPM wiki pages (vendor-specific). Not surfaced as a partner-queryable API.
- **Portal pattern** — the portal doesn't have a "what's mutable vs. needs to wait" UI today. The CLI gets to be ahead.

### What we shipped: [#296](https://github.com/pax8labs/pax8-cli/pull/296)

Pre-flight check in `subscriptions update`:
- Loads `subscription.commitment.endDate` before any API call
- **Quantity decrease** (new qty < current qty) on a committed sub → block with `CliError(ERROR_API_VALIDATION)` + recovery steps:
  - "Wait until {commitment term end date} to decrease quantity"
  - "Or use the Pax8 portal for early changes"
- **Billing-term change** on a committed sub → block with `CliError(ERROR_API_VALIDATION)` + recovery steps:
  - "Wait until commitment ends to change billing term"
  - "Or use the Pax8 portal for cancel-and-reorder workflow"
- **Quantity increase** → pass through (vendor-specific cancel windows NOT decoded; would be fragile)
- API rejections that slip through wrapped in `CliError(ERROR_API_VALIDATION)` with a generic "may be commitment-restriction" hint pointing at the portal

### What's intentionally out of scope

- `--at-renewal` flag (no API to back it; if we add it later, it'd be a CLI-side reminder concept, not API-backed)
- Per-vendor cancel-window logic (NCE 7-day, etc.) — too non-uniform; would be fragile to mirror
- Migrating to the structured ADR-0082 error envelope when the v2 API ships

### Conclusion

**Shipped. No PM action required** — vocabulary and design are grounded in canonical Pax8 internal research.

---

## 3. `subscriptions cancel` — commitment limitations

### Reviewer feedback (verbatim)

> "subscriptions cancel <id> has a lot of limitations due to commitments"

### What we did

Pax8-internal Rovo research across the Pax8 Direct User Agreement (TOS), NCE policy macros, [AOS-G order rules](https://pax8.atlassian.net/wiki/spaces/PTSP/pages/970096735/AOS-G+Orders), 10+ vendor integration pages, [NCT meeting notes](https://pax8.atlassian.net/wiki/spaces/MOIA/pages/2768240658/Pax8+NCT+Meeting+Requests+Action+Items), the [WHMCS integration behavior](https://pax8.atlassian.net/wiki/spaces/EE/pages/707231908/Success+Report+for+EMEA-8195), the [Cancelling Subscription Mobile App PRD](https://pax8.atlassian.net/wiki/spaces/PM/pages/636551343/Cancelling+Subscription), and 80+ supporting docs.

### Critical vocabulary finding

**There is no Pax8 early-termination fee.** Per the [Pax8 Direct User Agreement TOS](https://pax8.atlassian.net/wiki/pages/viewpageattachments.action?pageId=508201048&preview=%2F508201048%2F508201058%2FTOS+PAX8+Direct+User+Agreement.pdf):

> "You may terminate this Agreement at any time by cancelling your subscription… all fees paid are nonrefundable. If you cancel before the expiration of the subscription term, you will not receive a refund."

That's a "no refund" policy, not a "penalty on top." The financial consequence of mid-commitment cancel is *"you keep paying through commitment term end"* — not *"you pay a fee."* Earlier draft scope used "ETF" language; this was caught and corrected.

### Vendor enforcement variation

Wildly non-uniform. Sample:
| Vendor | Mid-term cancel rule |
|---|---|
| Microsoft NCE | 7-day window from purchase/renewal |
| Microsoft AOS-G | 14 / 60 / 180-day windows depending on signed agreement |
| Microsoft Azure Savings Plans | **Cannot be cancelled. Ever.** |
| Adobe | 14-day window at renewal only |
| Compliance Scorecard | Mid-term not permitted |
| INKY | Mid-term blocked; vendor system redirects |
| Sophos | Multi-step vendor coordination required |
| Acronis | Minimum monthly commitment adjustment line items |
| Timus Networks | 30-day window from sign-up |

CLI cannot encode these — they're scattered across internal-only Pax8 docs and would be fragile. Same conclusion as #293.

### Canonical Pax8 phrasing (matching NCT meeting notes, MTS macros, WHMCS integration)

- ✓ "commitment term end date" (not "renewal date" — they can differ; see [Legacy Billing](https://pax8.atlassian.net/wiki/spaces/MOBO/pages/1967882433/Legacy+Billing) misalignment docs)
- ✓ "Schedule cancellation for the commitment term end date"
- ✓ "Cancelling now will not stop billing through {date}"
- ❌ "early-termination fee" / "ETF" / "penalty" / "cancellation fee" (none of these reflect how the system works)

### What we shipped: [#302](https://github.com/pax8labs/pax8-cli/pull/302)

Commitment-aware preview block on committed subs, surfaced before the destructive confirm:

```
  ⚠ COMMITMENT ACTIVE

  Product            Microsoft 365 Business Premium
  Commitment term    1-Year (ends 2026-05-11)
  Days remaining     2
  Estimated cost through term end   $3,740.00
    (price × quantity × remaining months — estimated, not guaranteed)

  Defaulting to schedule cancellation for the commitment term end date.
  Use --immediately to cancel today, or --cancel-date <YYYY-MM-DD> to schedule a different date.
```

Behavior:
- **Committed sub + no flags** → defaults to cancellation at commitment term end date (canonical safe path; matches WHMCS integration's out-of-window auto-schedule pattern)
- **`--immediately`** flag → cancel today, override safe-path default
- **`--cancel-date <date>`** → respects #256's explicit-date contract
- **Non-committed (Monthly) subs** → unchanged behavior (no preview block)
- **API rejection on edge cases** (NCE 7-day expired, Adobe out-of-window, Sophos coordination required, etc.) → wrapped in `CliError(ERROR_API_VALIDATION)` with generic "may be vendor-specific enforcement; see Pax8 portal" hint

**Vocabulary regression-tested:** the new test asserts cancel output and help text never contain "ETF" / "early-termination" / "penalty" / "cancellation fee."

### Conclusion

**Shipped. No PM action required** — vocabulary discipline and design grounded in Pax8 canonical phrasing.

---

## 4. `subscriptions renewals` — MRR conversion is weird

### Reviewer feedback (verbatim)

> "subscriptions renewals converting to mrr is weird and i think there are probably better ways to answer 'what is at risk?'"

### What we did — first pass

Pax8-internal Rovo research across the [Unified Semantic Layer PRD](https://pax8.atlassian.net/wiki/spaces/DS/pages/2928902151/Unified+Semantic+Layer+PRD), [Partner Tiering / Voyager Alliance](https://pax8.atlassian.net/wiki/spaces/VLR/pages/1212711312/Partner+Tiers+Levels), the data warehouse fact tables, the [AMER Recurring Net Bookings Query Standard](https://pax8.atlassian.net/wiki/spaces/DAO/pages/2932867290/AMER+Recurring+Net+Bookings+Query+Standard+Methodology), the OE Glossary, and [PFR-86](https://pax8.atlassian.net/browse/PFR-86)'s board-facing escalation language.

### Headline finding

**MRR with `(annual_price × quantity) ÷ 12` amortization IS Pax8's canonical convention.** Explicitly confirmed by:
- Voyager Alliance Partner Tiering ("Microsoft NCE Annual Paid Upfront of $1200/year. Monthly Pax8 Spend will include $100/month")
- Unified Semantic Layer PRD ("Partner Gross MRR")
- dwh `fact_transaction_monthly` (stores annual subs as monthly-amortized)
- AMER Recurring Net Bookings methodology

The reviewer's instinct ("MRR for an annual contract feels weird") was valid as instinct but technically misaligned — the math is exactly what Pax8 internally uses. ARR is the derived board/investor metric (PFR-86: "$12M ARR partner at explicit churn risk").

### What we shipped: [#297](https://github.com/pax8labs/pax8-cli/pull/297)

- Added `arrAtRisk` per renewal + `totalArrAtRisk` aggregate (= MRR × 12 — partners building QBR decks and escalation narratives use the annualized framing)
- Canonical MRR/ARR definitions added to `subscriptions renewals --help`, `report mrr --help`, `report growth --help`, and the README "Metric definitions" section. Wording mirrors the Unified Semantic Layer:

> MRR (Monthly Recurring Revenue): Monthly recurring revenue from active subscriptions. For monthly billing terms: price × quantity. For annual billing terms: (price × quantity) ÷ 12. Excludes one-time charges and prorated amounts. Equivalent to "Partner Gross MRR" in Pax8's internal metric taxonomy.
>
> ARR (Annual Recurring Revenue): MRR × 12. The yearly equivalent of MRR, used to measure long-term financial health.

The CLI is intentionally becoming a de facto Pax8 partner-facing metrics definition, since none exists today.

### What we did — second pass

A follow-up Rovo query on broader CLI vocabulary (recommendations taxonomy, audit discrepancy types, MRR/ARR labels) surfaced a more important issue: **`mrrAtRisk` silently conflicted with Pax8's patent-filed Revenue at Risk Predictor**.

Pax8 has a real ML model (per the [Invention Disclosure Form](https://pax8.atlassian.net/wiki/spaces/EO/pages/348652127/Invention+Disclosure+Form+-+Pax8+Revenue+at+Risk+Predictor)) that predicts >50% GMRR drop over 9 months. Internally "at risk" means *churn likelihood prediction* — not *renewing soon*. The CLI's `mrrAtRisk` was a temporal filter, conflating with a real Pax8 product.

### What we shipped: [#299](https://github.com/pax8labs/pax8-cli/pull/299)

- Renamed `mrrAtRisk` → `mrrRenewing` and `arrAtRisk` → `arrRenewing` (with deprecated aliases for one cycle so existing scripts don't break)
- Renamed CLI's "uncovered seats" → "mismatched seats" (Pax8's canonical "Seat Utilization" means single-product assigned-vs-purchased; CLI's metric is cross-product mismatch — different concept)
- Added help-text disclaimers on `cross_sell` (CLI collapses multiple OE Opportunity Explorer types) and `seat_gap` (CLI-invented heuristic; will retire when [#62 OE first-party API](https://github.com/pax8labs/pax8-cli/issues/62) ships)
- Added a direction note in `invoices audit --help` clarifying partner-side reconciliation (vs. Pax8 internal vendor-side, which uses the same "discrepancy" word)
- Added Partner Gross MRR qualifier across MRR labels

### Conclusion

**Shipped. No PM action required** — the unit math is canonical Pax8, and the naming conflict with the Revenue at Risk Predictor was caught and fixed.

---

## Bonus: Webhook `secret` exposed Tier 0 (security finding)

### How it surfaced

A broader Rovo audit of remaining surfaces (Contacts / Invoices / Orders / Quotes / Usage / Webhooks — companion to concern 1) flagged the `secret` field on `pax8 webhooks show <id>` as exposed in cleartext. Per the Data Risk Tiering standard, HMAC signing keys are **Tier 0 (Existential)**.

### Impact

Any script piping `webhooks show --json` to a log, file, or monitoring tool was publishing the HMAC key. Industry-standard pattern (Stripe / GitHub / Twilio): show once on create, never on read.

### What we shipped: [#301](https://github.com/pax8labs/pax8-cli/pull/301)

- `webhooks show` — `secret` stripped from output (omit, not mask)
- `webhooks list` — `secret` never included (verified)
- `webhooks logs` — `secret` never included (verified)
- `webhooks create` — `secret` displayed once with "save this now, it won't be shown again" warning (existing behavior; warning text strengthened)
- Zod schema comment marks the field Tier 0 with the omitted-on-read contract
- `SECURITY.md` gains an aggregation-principle paragraph for the bulk-iteration concern

### Conclusion

**Shipped. Critical fix; pre-v0.1.0 blocker resolved.**

---

## 5. Other Rovo-grounded confirmations (no action needed)

Two additional field-tier questions arose from the broader audit. Both resolved without code change:

- **Quotes `salesMarginPercentage`** — confirmed via [QUOTE-1980](https://pax8.atlassian.net/browse/QUOTE-1980), [QUOTE-2410](https://pax8.atlassian.net/browse/QUOTE-2410), and the [Quoting team's CPQ Public APIs PRD](https://pax8.atlassian.net/wiki/spaces/Quoting/pages/1050247331/CPQ+Public+APIs) — this is the **partner's self-configured markup** to their end client (Tier 2), not Pax8's internal margin (which would be Tier 1). Demo data variance (15% / 18.5% / 21% per quote) is exactly the expected pattern for per-deal partner pricing. Safe to ship as-is.
- **Usage `partnerTotal` / `cost`** — moot; the CLI's actual usage schema (`UsageSummary`, `UsageLine`) exposes `unitPrice` and `subtotal`, NOT `partnerTotal` or `cost`. By the same logic that resolved invoices and orders (`unitPrice` = `partnerBuyRate`), usage is already safe.

---

## 6. Open for PM input

Honestly, very little. Most items are external coordination, not product decisions.

### Genuine product / domain questions

- **One-cycle deprecation period for `mrrAtRisk` / `arrAtRisk` aliases** (from #299) — currently kept as deprecated aliases for one minor version. PM may want to extend (more partner-script-friendly) or keep as-is. Default: drop in v0.3.0.
- **OE first-party recommendations API migration roadmap** ([#62](https://github.com/pax8labs/pax8-cli/issues/62)) — when does this ship? The CLI's `cross_sell` / `seat_gap` taxonomy is simplified vs. OE's full 5-type taxonomy (Upsell / Cross-Sell / Add-On / Upgrade / Net-New) and will need to migrate when the API lands. Currently flagged in help text as CLI heuristic.
- **#251 — computed surfaces sign-off** (meta-issue Cassie filed): renewals, audit, recommendations, MRR, cost sim need domain-owner sign-off before public ship. This is a process item the domain owner closes; not code.

### External coordination (not me, not PM-blocking-the-code)

- **npm OIDC trusted publisher** config for `@pax8/cli` and `@pax8/core` at npmjs.com — blocks the v0.2.0 publish; doesn't block PM review.
- **Public org name decision** (`pax8-oss/pax8-cli`?) — unblocks the [#141](https://github.com/pax8labs/pax8-cli/issues/141) internal-URL sweep.
- **Public-repo creation** in the chosen org — Pax8 GitHub org admin.
- **LICENSE wording sign-off** — Courtney Norton (Legal).
- **Second peer reviewer** named beyond Cassie — Josh.

### What's already in README "Known Limitations"

- Real-API issues: orders list timeout ([#199](https://github.com/pax8labs/pax8-cli/issues/199)), usage list 404 ([#212](https://github.com/pax8labs/pax8-cli/issues/212)), doctor strictness ([#220](https://github.com/pax8labs/pax8-cli/issues/220))
- Demo-mode polish: fixture richness ([#196](https://github.com/pax8labs/pax8-cli/issues/196)), empty-state rendering ([#197](https://github.com/pax8labs/pax8-cli/issues/197))
- Tooling: TTY-mode UX matrix coverage (needs node-pty harness — tracked as follow-up), update-notifier ([#183](https://github.com/pax8labs/pax8-cli/issues/183)), api-watch widening ([#213](https://github.com/pax8labs/pax8-cli/issues/213))

These are all v0.1.x deferred per the original release plan and don't need PM input.

---

## 7. PRs shipped in this review cycle (full list)

| PR | Closes | Description |
|---|---|---|
| [#296](https://github.com/pax8labs/pax8-cli/pull/296) | #293 | Subscriptions update commitment-aware pre-flight |
| [#297](https://github.com/pax8labs/pax8-cli/pull/297) | #295 | Renewals `arrAtRisk` companion + canonical MRR/ARR docs |
| [#299](https://github.com/pax8labs/pax8-cli/pull/299) | #298 | Vocabulary alignment: `mrrAtRisk` → `mrrRenewing`, recommendation taxonomy disclaimers, invoices audit direction note |
| [#301](https://github.com/pax8labs/pax8-cli/pull/301) | #300 | Webhook `secret` Tier 0 redaction (security) |
| [#302](https://github.com/pax8labs/pax8-cli/pull/302) | #294 | Subscriptions cancel commitment-aware preview |

All five merged. Test suite at 1571+ passing / 8 skipped. CI green on Node 20+22 × ubuntu+windows.

---

## 8. Asking for sign-off

Specifically:

1. **Review the four resolutions** above. If any feel wrong (vocabulary choice, design call, scope), say so — we built each on Rovo-grounded internal research, but you have product authority and might see things the research didn't catch.
2. **Disposition of the deprecated `mrrAtRisk` / `arrAtRisk` aliases** — keep for one cycle (default) or longer?
3. **Implicit sign-off on the field-tier audit conclusions** — the CLI's exposed surface is Tier 2/4; we believe this is safe for public OSS, grounded in the FINAL Marketplace & Platform Data Risk Tiering standard. If PlatSec (Matt Dunham) wants a separate review pass, we'd welcome it.
4. **[#251](https://github.com/pax8labs/pax8-cli/issues/251) — computed-surfaces domain-owner sign-off** — meta-issue still open as the holding spot for explicit sign-off on renewals / audit / recommendations / MRR / cost sim. Closing it is the PM's call, not ours.

Thanks for the review. The four concerns drove some of the most valuable internal-vocabulary research we've done — the team is in a meaningfully better shape on Subscriptions because you raised them.
