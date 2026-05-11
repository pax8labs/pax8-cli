# Triage — `pax8 recommendations` vs. Pax8 Opportunity Explorer (OE) canon

**Status:** Originally a read-only audit (2026-05-11). The narrow, additive
resolution ("Path B") for surprise #7 and the OE 5-type axis shipped in a
follow-up PR: additive `opportunityType` field on every recommendation,
zero-sub companies reclassified as `Net-new`, new `pax8 recommendations
upsell --from-product --to-product` command, and the STAX-divergence doc
comment at the top of `packages/core/src/services/recommendations.ts`. The
retain-as-is items (7 product categories, `seat_gap` rename, `coverage: 'n/7'`
migration) are tracked for v0.2 in #375.

**Date:** 2026-05-11.

This doc inventories the current CLI recommendations surface, classifies every category, rule, and term against Pax8's canonical Opportunity Explorer (OE) vocabulary, and enumerates **material surprises** the user should weigh before authorizing a rename/rewrite.

---

## 0. Canonical access — what I could and could not verify

- **OE rules page** ([`https://pax8.atlassian.net/wiki/spaces/OE/pages/934674534/`](https://pax8.atlassian.net/wiki/spaces/OE/pages/934674534/)) — partner-portal gated; not fetched. **Canon claims below are reproduced from the prompt and from in-repo prior research (`docs/triage/mcp-use-case-alignment.md`, `docs/pm-review-response-2026-05.md`).** Where this audit cites "Pax8 canon" without a verifiable URL, treat as second-hand.
- **Verified in-repo:** OE 5-type taxonomy (Upsell / Cross-Sell / Add-On / Upgrade / Net-New) is referenced at `docs/pm-review-response-2026-05.md:296` and `docs/triage/mcp-use-case-alignment.md:77,97`. Seat Utilization canonical name is referenced at `docs/triage/mcp-use-case-alignment.md:73,86`. ARC-785 / `GET /opportunities` is **not** referenced anywhere in this tree.

---

## 1. Current CLI surface

### 1.1 Top-level commands

| Surface | File:line | Description |
|---|---|---|
| `pax8 recommendations list` | `packages/cli/src/commands/recommendations/list.ts:59-310` | Read-only ranked list. Supports `--company`, `--priority`, `--type`, `--product`, `--include-all`, `--with-actions`, `--limit`, `--json`, `--csv`. |
| `pax8 recommendations act` | `packages/cli/src/commands/recommendations/act.ts:157-334` | Write. Interactive multi-select picker → batched `orders.create`; `--yes` bypasses. |
| `pax8 recs …` (alias) | `packages/cli/src/commands/recommendations/index.ts:11` | Shorthand for `recommendations`. |

### 1.2 Cross-surface consumers (same engine)

| Surface | File:line | What it reads |
|---|---|---|
| `pax8 companies list --coverage` | `packages/cli/src/commands/companies/list.ts:45,87,111-112,118-131,150-158` | Calls `getRecommendations()` then `getPortfolioCoverage()`. Surfaces `coverage` ("n/7"), `coveredCategories[]`, `missingCategories[]`, `estimatedUplift` — adds them to JSON output (lines 155-158) and table cells. |
| `pax8 dashboard` | `packages/cli/src/commands/dashboard.ts:139-156,221-222,241-246,293-294,414-425,478-484` | Calls `getRecommendations()`, filters `priority === "high"`, renders Growth section, emits `highPriorityRecs` + `potentialMrrUplift` in JSON. Quick Actions reads `r.orderCommand`, `r.suggestedProducts`, `r.title`. |
| Claude Skill tool | `packages/claude-skill/src/tools/recommendations.ts:9` | Tool description hardcodes `"type (cross-sell or seat-gap)"`. |

### 1.3 Exported public API (`@pax8/core`)

`packages/core/src/services/index.ts:9` re-exports: `getRecommendations`, `getPortfolioCoverage`, `categorizeProduct`, `ALL_CATEGORIES`, type `Recommendation`, type `RecommendationReport`, type `CompanyCoverage`, type `ProductCategory`. **All seven category strings are part of the type union and are reachable by `@pax8/core` consumers.**

### 1.4 `Recommendation` JSON contract

Type at `packages/core/src/services/recommendations.ts:229-249`. Fields: `companyId, companyName, type, priority, title, reason, suggestedProducts[], orderCommand, productAvailable, currentMrr, estimatedMrrUplift, targetSeats, estimateType`. Surfaced verbatim in `--json` (`list.ts:160`) and `--with-actions` (`list.ts:158`). Mirrored in `docs/domain-review.md:371`.

---

## 2. Current categories — classification vs. canon

Defined at `packages/core/src/services/recommendations.ts:11-18` (type), `:25-54` (regex rules), `:56-64` (`ALL_CATEGORIES`).

| # | Category string | Status vs. canon | Notes |
|---|---|---|---|
| C1 | `productivity` | ❓ Ambiguous | Not in the verifiable OE 5-type taxonomy (taxonomy is opportunity *types*, not product *categories*). Internal product-category vocabulary at Pax8 may differ; **canonical category list not in this repo.** Flag for triage. |
| C2 | `email` | ❓ Ambiguous | Same as C1. |
| C3 | `security` | ❓ Ambiguous | Same as C1. |
| C4 | `endpoint_protection` | ❓ Ambiguous | Same as C1. |
| C5 | `identity` | ❓ Ambiguous | Same as C1. |
| C6 | `backup` | ❓ Ambiguous | Same as C1. |
| C7 | `cloud_infrastructure` | ❓ Ambiguous | Same as C1. |

**Key point:** the seven categories are **product-category labels**, not OE opportunity *types*. The OE 5-type taxonomy and the CLI's 7-category taxonomy are orthogonal axes. **A "rename categories to match OE" instruction would be a category error** unless OE itself publishes a canonical product-category list (no evidence in this tree).

Pattern matches against product names are **single-rule, English-only, lossy** — `defender` matches both `security` and `endpoint_protection` (`:35,39`); `Microsoft Defender for Identity` would mis-categorize; `Acronis Cyber Backup` matches `backup` correctly but `Acronis Cyber Protect` (which includes endpoint) would only hit `backup` via `acronis`.

---

## 3. Current rules — classification vs. canon

### 3.1 Opportunity types (`type` field, `recommendations.ts:232`)

| Value | Status | Notes |
|---|---|---|
| `cross_sell` | ✏️ Naming drift | Maps to OE's **Cross-Sell** in name. Help text at `list.ts:78-83` already discloses the CLI collapses OE's Cross-Sell + Net-New + Add-On into this single label. So the **value name aligns**; the **semantic coverage is broader than canonical Cross-Sell**. |
| `seat_gap` | ❌ Invented | Not in OE taxonomy. CLI heuristic. Help text at `list.ts:85-91` already discloses this. Not equivalent to canonical **Seat Utilization** (which is single-product), and not equivalent to OE's **Upsell** (which is in-product expansion). |

### 3.2 Cross-sell rules (`recommendations.ts:89-146`)

Shape: "if has category X but missing category Y → recommend product list Z."

| # | Rule | File:line | Priority | Status vs. canon |
|---|---|---|---|---|
| R1 | productivity → backup | `:90-97` | high | ❓ Ambiguous — generic IT-stack heuristic. Likely sound regardless of OE; **canonical text on OE page not verified.** |
| R2 | productivity → endpoint_protection | `:98-105` | high | ❓ Same as R1. |
| R3 | productivity → identity | `:106-113` | high | ❓ Same as R1. |
| R4 | email → security | `:114-121` | medium | ❓ Same as R1. |
| R5 | cloud_infrastructure → backup | `:122-129` | medium | ❓ Same as R1. |
| R6 | cloud_infrastructure → security | `:130-137` | medium | ❓ Same as R1. |
| R7 | security → backup | `:138-145` | low | ❓ Same as R1. |

**Hardcoded suggested product names** (`recommendations.ts:95,103,111,119,127,135,143`) include `"AvePoint Cloud Backup for Microsoft 365"`, `"Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]"`, `"Microsoft Entra ID P1 [New Commerce Experience]"`, `"CrowdStrike MSSP Complete Defend"`, `"SentinelOne Singularity Complete"`, `"Datto SaaS Protection"`, `"Veeam Backup"`, `"Mimecast"`, `"JumpCloud"` — these are SKU strings that will break on vendor rename (`docs/triage/mcp-use-case-alignment.md:103`).

### 3.3 Seat-gap thresholds (`recommendations.ts:161-206`)

| Threshold | Value | File:line | Status |
|---|---|---|---|
| Primary product min seats | ≥ 10 | `:184` | ❌ Invented |
| Secondary coverage ratio | < 50% | `:191` | ❌ Invented |
| Missing seats min | ≥ 10 | `:191` | ❌ Invented |
| High-priority escalation | missing > 20 | `:509` | ❌ Invented |

The 85% Seat Utilization target referenced in the prompt is **a single-product assigned-vs-purchased ratio**; it has no obvious mapping to this cross-product comparison. Different metric, different denominator.

### 3.4 Other rule-ish constants

| Item | File:line | Status |
|---|---|---|
| `RESTRICTED_PATTERNS` regex (non-profit/charity/GCC/education/government/AOS) | `:360` | ✅ Sound (commercial-only filter; defensible regardless of canon). |
| Zero-subscription company flag | `:526-547` | ❓ CLI-invented "Net-New" surrogate; arguably maps to OE **Net-New**. Priority hardcoded `high`. |
| Dedupe key | `:555` (`companyId:type:title`) | ❌ CLI-invented; tied to current `type` strings. |
| Priority order | `:563` (`high=0, medium=1, low=2`) | ✅ Maps to OE priority canon (assumed). |
| Estimate semantics | `:248,489,521` (`estimateType: "upper_bound"`) | ✅ Already disclaims it is **not** PMRR (`list.ts:93-97`). |

---

## 4. `seat_gap` references — exhaustive list

| File | Line | Context |
|---|---|---|
| `packages/core/src/services/recommendations.ts` | `:232` | Type union member: `"cross_sell" \| "seat_gap"` (exported via `@pax8/core`) |
| `packages/core/src/services/recommendations.ts` | `:508` | Sets `type: "seat_gap"` on synthesized rec |
| `packages/core/src/services/recommendations.ts` | `:510-513` | Comment discussing disambiguation from Seat Utilization |
| `packages/core/src/services/recommendations.ts` | `:554` | Dedupe comment ("For seat_gap, dedupe by company + product") |
| `packages/core/src/services/recommendations.test.ts` | `:105` | Test: `r.type === "seat_gap"` |
| `packages/cli/src/commands/recommendations/list.ts` | `:39` | Column formatter: `String(v) === "seat_gap" ? "Seat Gap" : "Cross-sell"` |
| `packages/cli/src/commands/recommendations/list.ts` | `:63` | Help: `--type <type>` "(seat_gap or cross_sell)" |
| `packages/cli/src/commands/recommendations/list.ts` | `:85-91` | Help-text disclaimer paragraph |
| `packages/cli/src/commands/recommendations/act.ts` | `:153` | `rec.type === "seat_gap" ? "Bump" : "Add"` in picker label |
| `packages/cli/src/commands/recommendations/filter.test.ts` | `:38,107-110` | Filter tests assert literal value |
| `packages/claude-skill/src/tools/recommendations.ts` | `:9` | Skill tool description literal: `"seat-gap"` (hyphen variant) |
| `packages/claude-skill/skill.md` | (implicit) | No literal `seat_gap`, but references the `--type` flag indirectly |
| `docs/domain-review.md` | `:371` | Documents the type union |
| `docs/triage/mcp-use-case-alignment.md` | `:73,86` | Triage doc already flags seat_gap divergence |
| `docs/pm-review-response-2026-05.md` | `:245,296` | PM response acknowledges as CLI-invented |
| `README.md` | `:478` | User-facing docs reference `seat_gap` |
| `README.md` | `:475-482` | "Cross-product coverage gaps vs. Seat Utilization" section |
| `CHANGELOG.md` | `:9,23` | Release notes disclaim |

**Critical:** `seat_gap` is **part of the exported TypeScript type union** in `@pax8/core` (`recommendations.ts:232`, re-exported from `services/index.ts:9` and the package root `index.ts:228-236`). Renaming it is a **breaking API change** for any `@pax8/core` embedder.

---

## 5. Material surprises ⚠️

These are the things that should give the user pause before authorizing a clean rename/rewrite. **This is the headline section.**

### S1. The "all 7 categories are invented" framing is technically defensible but the right axis to fight on isn't categories — it's the conflation of two orthogonal taxonomies.

OE's **5-type taxonomy** (Upsell / Cross-Sell / Add-On / Upgrade / Net-New) is opportunity *types* — what kind of motion this is. The CLI's **7-category taxonomy** is product *categories* — what kind of thing is being sold. **These are different axes.** A rename prompt that says "adopt OE's 5 types" does **not** tell you what to do with the 7 product categories. Pax8 likely has a canonical product-category list internally, but **no evidence of it exists in this tree** (`docs/triage/mcp-use-case-alignment.md:74` flags this exact gap as a "joint gap"). If you proceed without nailing this down, the rewrite will replace 7 invented categories with 7 newly-invented categories that just *look* more canonical.

### S2. `seat_gap` is in the **exported public TypeScript type** of `@pax8/core`.

`packages/core/src/services/recommendations.ts:232` declares `type: "cross_sell" | "seat_gap"`. That type is re-exported as `Recommendation` from the package root (`packages/core/src/index.ts:228-236`). **Embedders of `@pax8/core` will fail to compile if you rename it.** This is not just a CLI string — it is an SDK contract. The current prompt's framing as "rename" understates this. README at `README.md:274` explicitly markets `@pax8/core` as importable into "a portal feature, a Lambda, a dashboard, or your own tool."

### S3. `seat_gap` is also part of the **`--json` output contract** of `pax8 recommendations list`.

`list.ts:160` writes raw `Recommendation[]` to stdout. Agents and scripts (including the Claude skill at `packages/claude-skill/src/tools/recommendations.ts:9`) filter on `r.type === "seat_gap"`. Renaming changes downstream tooling behavior silently. The `CLAUDE.md` agent contract at the root already encodes `r.orderCommand` extraction; if you change `type`, you should also publish an alias period like the recent `mrrAtRisk → mrrRenewing` migration (see `CHANGELOG.md:23`, which kept both keys for one minor cycle).

### S4. `pax8 dashboard` depends on the literal string `"high"` for priority filtering.

`packages/cli/src/commands/dashboard.ts:222`: `recsReport.recommendations.filter((r) => r.priority === "high")`. The dashboard's "Growth Opportunities" section, JSON `highPriorityRecs` / `potentialMrrUplift` fields (`:293-294`), and Quick Actions block (`:415-424`) all consume `r.title`, `r.suggestedProducts`, `r.orderCommand`, `r.estimatedMrrUplift`. **A rewrite that changes the shape of `Recommendation`, the priority enum, or the title format silently changes the dashboard.** Not a blocker — but the rewrite spec needs to enumerate these fields as part of the contract surface, not just the categories.

### S5. `pax8 companies list --coverage` exposes the **literal coverage string "n/7"** in JSON.

`recommendations.ts:314`: `coverage: \`${coveredCategories.length}/${ALL_CATEGORIES.length}\``. That `7` is `ALL_CATEGORIES.length`. The output is surfaced verbatim in `companies/list.ts:155` as `row.coverage`. **If the category count changes (e.g. 7 → 5 or 7 → 9), every consumer parsing `"3/7"` as a fraction or denominator breaks.** This includes any external dashboard a partner has built on top. The `0/7` fallback for zero-sub companies is also hardcoded (`companies/list.ts:127`). Need a one-cycle alias period or a structural format like `{ covered: 3, total: 7 }`.

### S6. The CLI already collapses OE's 5-type taxonomy into 2 types **with explicit help-text disclaimers**.

`list.ts:77-91` discloses that `cross_sell` collapses Cross-Sell + Net-New + Add-On, and that `seat_gap` is a CLI heuristic. This was the resolution of #298 (`CHANGELOG.md:9`). **The framing "all 7 are invented, let's adopt canon" is partly already settled** — the maintainers already chose disclosure-over-rewrite and pinned the full migration to ARC-785 / issue #62. A rewrite now relitigates a recently-closed decision; before authorizing, the user should know which way #62 is currently leaning.

### S7. Zero-subscription companies are silently emitted as `type: "cross_sell"` recs.

`recommendations.ts:526-547` synthesizes a high-priority `cross_sell` rec for every company with no active subs, with empty `suggestedProducts`, null `orderCommand`, and `productAvailable: false`. **This is the closest existing surrogate for OE's "Net-New" type** and arguably should migrate there before anything else does. Currently it travels as `cross_sell` and gets filtered out of the actionable view because `productAvailable: false` (`list.ts:169`). Worth being deliberate about during the rewrite — it's a real opportunity type masquerading as a cross-sell.

### S8. Hardcoded SKU strings are the real fragility, not the category names.

`recommendations.ts:95,103,111,…` contain literal vendor SKU strings like `"Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]"`. These break silently on vendor rename. `docs/triage/mcp-use-case-alignment.md:103` already calls this out. **A rewrite focused on category/type names that doesn't also externalize the suggested-product list is fixing the cosmetic problem while leaving the real one in place.**

### S9. The `seat_gap` heuristic uses `quantity` from `Subscription` as a coverage proxy.

`recommendations.ts:181-203` treats *purchased quantity* as a proxy for *covered seats*. This is wrong for both the canonical Seat Utilization metric (which uses assigned seats, not purchased) **and** for cross-product gap detection (which assumes the same denominator applies — i.e. that 100 productivity seats means 100 humans, and 30 backup seats means 70 humans uncovered). It's a reasonable rough cut, but **it's epistemically the same kind of approximation the prompt's premise objects to in the canonical Seat Utilization comparison** — i.e. if you rename `seat_gap` to align with canon, the underlying logic still won't be canon-grade.

### S10. The Claude Skill description hardcodes the hyphenated variant `"seat-gap"`.

`packages/claude-skill/src/tools/recommendations.ts:9` says `"Returns type (cross-sell or seat-gap)"`. The actual JSON values are `cross_sell` and `seat_gap` (underscored). This is a pre-existing minor bug in the skill description, but a rewrite must touch this too or the new term won't match the description either.

### S11. The `RESTRICTED_PATTERNS` filter has real business value and is non-obvious.

`recommendations.ts:360`: `/non-profit|charity|gcc|education|faculty|student|government|\bAOS\b/i`. This silently skips SKUs that aren't orderable for commercial customers. A rewrite that doesn't preserve this regex will produce recs that error on submission. Important to carry forward.

---

## 6. Recommended action per finding

| Item | Recommendation |
|---|---|
| C1–C7 (7 categories) | **Flag for discussion.** Do not rename until a canonical Pax8 product-category list is identified. If none exists, document this as a CLI-invented taxonomy and stop calling it a "rename" — it's a domain-modeling exercise. |
| Type `cross_sell` | **Keep, document scope.** Name aligns with OE. Document (already done at `list.ts:78-83`) that scope is broader. |
| Type `seat_gap` | **Two-cycle deprecation with alias**, mirroring the `mrrAtRisk → mrrRenewing` pattern (`CHANGELOG.md:23`). Don't hard-rename. The new name needs to be picked from canon, not invented (see S1) — `upsell`, `add_on`, `coverage_gap`, or a structural change all have different downstream implications. |
| Type `cross_sell` for zero-sub companies | **Move to a new type (`net_new`?)** with a one-cycle alias if you adopt OE's Net-New. See S7. |
| Cross-sell rules R1–R7 | **Keep, but externalize.** Move to a data file the user can override; if/when OE ships a canonical rule list, swap the data source. |
| Seat-gap thresholds (50% / 10 seats / 20 high) | **Keep**, but expose as configuration. |
| `RESTRICTED_PATTERNS` | **Keep verbatim.** Real business filter, non-canonical but correct. |
| Hardcoded SKU names | **Replace with a vendor-canonical product-keyword list.** Decouple from current Pax8 catalog naming. Higher priority than the rename. |
| `coverage: "n/7"` literal | **Add structured field** `{ covered, total }` alongside existing string; deprecate string after one cycle. |
| Dashboard `priority === "high"` filter | **Keep**, but pin priority enum as part of the contract spec, not an implementation detail. |
| Claude Skill description `"cross-sell or seat-gap"` | **Fix to underscored form** regardless of rewrite (pre-existing bug). |
| `@pax8/core` type exports | **Treat as semver-major** if you remove `seat_gap` without alias. Add to the rewrite spec explicitly. |

---

## 7. If-we-proceed-as-spec'd: smooth vs. friction

### Likely smooth

- Adding canonical OE 5-type strings as new `type` values alongside the existing two (additive, non-breaking).
- Adding new help-text disclaimers / renaming column headers (cosmetic, no contract impact).
- Externalizing thresholds to env vars or config (additive).
- Fixing the Claude Skill description hyphen bug.

### Likely friction

- **Hard-renaming `seat_gap` without an alias period** → breaks `@pax8/core` embedders (S2), `--json` consumers (S3), tests, agent prompts, and downstream tooling. Mirror the `mrrAtRisk → mrrRenewing` pattern.
- **Changing the 7-category taxonomy** → silently changes `companies list --coverage` `n/7` denominator (S5), breaks any partner-built dashboard reading `coveredCategories[]` / `missingCategories[]`. Needs structured `{ covered, total }` migration.
- **Replacing hardcoded suggested-product SKU strings** → larger refactor than the rename, but the real fragility (S8). Worth pairing with the rename.
- **Adopting OE 5-type taxonomy without nailing the product-category axis** → ships a half-rewrite that still has the same epistemic mismatch (S1). Both axes need explicit canonical sources before authorizing.
- **Relitigating #298** → the maintainers explicitly chose disclosure-over-rewrite three months ago (`CHANGELOG.md:9`, `docs/pm-review-response-2026-05.md:245`). The user should know they're reversing a recently-closed decision before authorizing (S6).

---

## 8. Bottom line for the authorizing user

The premise "all 7 categories are invented; let's adopt OE canon" is **only partly right**: the type axis (`cross_sell`/`seat_gap`) has a clean OE mapping in name though not in scope; the category axis (`productivity`/`email`/...) does not appear to have a canonical Pax8 source in this tree, so any rename will trade one invented vocabulary for another unless a canonical source is produced. The biggest concrete risks are not invention — they are the public `@pax8/core` type export of `seat_gap`, the literal `"n/7"` coverage string in JSON, the dashboard's structural dependency on `priority === "high"`, and the hardcoded SKU strings that are a bigger fragility than the names. A "clean rename" is not actually clean — it's a semver-major API change for `@pax8/core` and a contract change for the `--json` surface. Recommend a two-cycle alias migration plus an explicit decision about the product-category axis before any code changes land.
