# Triage — Pax8 MCP use case catalog vs. CLI recommendations engine

**Status:** Research-only audit. No code changes. **Date:** 2026-05-11.

## 1. Source access — gaps disclosed up front

The user referenced an internal doc citing ~8 MCP use cases. **The authoritative catalog at `https://app.pax8.com/integrations/guides` and the partner-portal MCP tab at `https://app.pax8.com/integrations/mcp` are gated; WebFetch returned permission-denied for both.** Findings below are composed from:

- `https://devx.pax8.com/docs/mcp-server` — accessible; lists capability *domains* and defers the full inventory to the gated Hub.
- Repo evidence: `README.md`, `docs/PRD.md`, `docs/domain-review.md`, `docs/pm-review-response-2026-05.md`, `packages/claude-skill/skill.md`.

**Baseline:** the accessible MCP surface lists **6 capability domains**; the repo's PM-facing PRD lists **6 AI-assisted use cases**. The "~8" figure is **unverified** pending an authenticated read of the Integrations Hub.

## 2. Pax8 MCP capability domains (devx, public)

Source: `https://devx.pax8.com/docs/mcp-server`. These are domains, not workflow use cases — Pax8's published MCP exposes raw resource CRUD.

| # | Domain | One-sentence description | Underlying API surface |
|---|---|---|---|
| D1 | Company & Contact Management | Access and manage organizational and personnel records. | `/companies`, `/contacts` |
| D2 | Invoices | Retrieve and interact with billing documents. | `/invoices` |
| D3 | Order Management | Place and inspect orders. | `/orders` |
| D4 | Products | Browse and retrieve product-catalog information. | `/products`, `/products/{id}/pricing` |
| D5 | Quoting | Generate and manage sales quotes. | `/v2/quotes`, `/v2/quotes/{id}/line-items` |
| D6 | Subscriptions | Oversee recurring service agreements. | `/subscriptions` |
| — | "Core use case" | "Unlock the power of integrating your Pax8 data with your favorite LLMs." | (marketing copy) |

**Named MCP tool in repo:** `pax8-submit-order` (Linear AI-865) — `docs/domain-review.md:518`.

## 3. CLI's computed surface

**Seven product categories** (`packages/core/src/services/recommendations.ts:11-64`): `productivity, email, security, endpoint_protection, identity, backup, cloud_infrastructure`. Pattern-matched against product names.

**Seven cross-sell rules** (`recommendations.ts:89-146`), shape "if has X, missing Y → recommend Z":

| # | If has | Missing | Priority | Suggested first product |
|---|---|---|---|---|
| R1 | productivity | backup | high | AvePoint Cloud Backup for M365 |
| R2 | productivity | endpoint_protection | high | Microsoft Defender for O365 P1 |
| R3 | productivity | identity | high | Microsoft Entra ID P1 |
| R4 | email | security | medium | Microsoft Defender for O365 P1 |
| R5 | cloud_infrastructure | backup | medium | AvePoint / Veeam |
| R6 | cloud_infrastructure | security | medium | CrowdStrike / SentinelOne |
| R7 | security | backup | low | AvePoint / Datto SaaS |

**Seat-gap detector** (`recommendations.ts:161-206`): within a category, sort subs by quantity; flag a secondary product when coverage `< 50%` of primary **and** missing ≥10 seats **and** primary ≥10 seats. High if missing >20 else medium.

**Surfaces exposing the engine:**
- `pax8 recommendations list` — `packages/cli/src/commands/recommendations/list.ts:59-306` (read-only).
- `pax8 recommendations act` — `packages/cli/src/commands/recommendations/act.ts:157-334` (multi-select picker → batched `orders.create`; confirm or `--yes`).
- `pax8 companies list --coverage` — `packages/cli/src/commands/companies/list.ts:45,84-156` via `getPortfolioCoverage` (`recommendations.ts:274-320`).
- `pax8 dashboard` — `packages/cli/src/commands/dashboard.ts:139-156,221-222` (fuses top-priority recs with renewals + MRR).

**Estimate semantics:** `estimatedMrrUplift = unitPrice × seatCount`, tagged `estimateType: "upper_bound"`. Help text (`list.ts:93-97`) disclaims this is **not** Pax8 PMRR.

## 4. Alignment matrix — MCP capability vs. CLI

| MCP domain / use case | CLI analog | Status | Notes |
|---|---|---|---|
| D1 Company & Contact Mgmt | `companies *`, `contacts *` | **Aligned (raw)** | CLI adds `--coverage` (computed). |
| D2 Invoices | `invoices list/show` | **Aligned (raw)** | CLI adds `audit`, `dispute` (CLI-only). |
| D3 Order Management | `orders *` | **Aligned (raw)** | `pax8-submit-order` ↔ `orders create`. Flag-naming coord flagged at `domain-review.md:518`. |
| D4 Products | `products search/show` | **Aligned (raw)** | CLI collapses pricing/provisioning/dependencies. |
| D5 Quoting | `quotes *` (line-items, send) | **Aligned (raw)** | Full Quote-to-Cash covered (`domain-review.md:506-516`). |
| D6 Subscriptions | `subscriptions *` | **Aligned (raw)** | CLI adds `renewals` (computed). |
| PRD: **Renewal triage** | `subscriptions renewals` + `dashboard` | **Aligned** | CLI composes; MCP path = LLM-composes from raw. |
| PRD: **Billing investigation** | `invoices audit`, `dispute` | **CLI-only** | No MCP analog visible. |
| PRD: **Customer overview** | `companies show`, `dashboard` | **Aligned** | Both can compose; CLI canonical via `dashboard`. |
| PRD: **Order assistance** | `products search` + `orders create` | **Aligned** | MCP path = `pax8-submit-order`. |
| PRD: **What-if / pricing delta** | `cost sim` | **CLI-only** | No documented MCP simulation tool. |
| PRD: **Anomaly detection** | `invoices audit` outliers | **CLI-only** | No MCP analog visible. |
| Cross-sell rules R1–R7 | `recommendations list` | **CLI-only** | Hardcoded; help text acknowledges collapses OE's 5-type taxonomy (`pm-review-response-2026-05.md:296`). |
| Seat-gap detection | `recommendations list --type seat_gap` | **Diverges** | CLI heuristic ≠ Pax8 "Seat Utilization." Retire when OE ships (#62). |
| Portfolio coverage (n/7) | `companies list --coverage` | **CLI-only / Diverges** | Category taxonomy is repo-invented. |
| Closed-loop batch ordering | `recommendations act` | **CLI-only** | MCP per-order tool doesn't batch. |
| Dashboard composition | `pax8 dashboard` | **CLI-only** | Fused MRR + renewals + recs; MCP is raw-resource. |
| OE 5-type taxonomy | (not implemented) | **Joint gap** | Neither side ships; #62 is the migration pivot. |
| MRR / ARR / growth analytics | `report mrr`, `report growth`, ARR-at-risk | **CLI-only** | Not a documented MCP capability. |

## 5. Strategic recommendations

**Align (shared-vocabulary opportunities):**

1. **`pax8-submit-order` ↔ `orders create` flag naming** — already flagged at `domain-review.md:518`. One-time coordination, high payoff before partners automate against both.
2. **Category taxonomy** — the seven CLI categories (`recommendations.ts:11-18`) are repo-invented. If OE has a canonical model, align before partners filter on `--type` (open Q1 at `domain-review.md:395`).
3. **`seat_gap` framing** — diverges from Pax8's canonical "Seat Utilization." Already planned for retirement when OE ships (#62). Do not market externally as Pax8-blessed in the meantime.

**Keep as CLI value-add (no MCP analog):**

4. **`invoices audit` / `invoices dispute`** — already framed as CLI-differentiating in `README.md:33`.
5. **`cost sim`** — what-if pricing without ordering.
6. **`dashboard`** — fused MRR + renewals + recs; the canonical landing surface per skill manifest.
7. **`recommendations act`** (closed-loop batch ordering) — MCP's per-order tool does not compose into a batch. Keep, but preserve the strict confirm-before-write contract (`skill.md:37-39`).

**Joint gaps (neither side ships):**

8. **OE 5-type opportunity taxonomy** (Upsell / Cross-Sell / Add-On / Upgrade / Net-New) — CLI collapses to 2 types as a stopgap; #62 is the migration pivot.
9. **License utilization / per-user assignments** — upstream API gap, not a CLI-vs-MCP divergence (`PRD.md:429-430`).

**Conflicts to flag:**

- Cross-sell reason strings (`recommendations.ts:93,99,108,…`) make security claims ("#1 attack vector") that need Pax8 messaging-owner review before external blessing (`domain-review.md:389`).
- Hardcoded SKU names (e.g. `"Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]"`) will silently break on vendor rename.

## 6. Named gaps in this audit

- **Cannot verify "~8" figure** — re-run from an authenticated portal session to close §2.
- **No public list of named MCP tools** beyond `pax8-submit-order`. Fold any per-tool inventory into §2/§4 when available.
- **OE first-party recs API (#62)** is the joint pivot; until it ships, both surfaces diverge informally.
