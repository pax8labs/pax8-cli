# Pax8 Marketplace CLI — Key Partner Workflows

> **Historical document.** This is the pre-launch workflow inventory that accompanied [`proposal.md`](./proposal.md). Every "Delivered" row maps to commands that shipped in v0.1.0 — for the current command surface see [`docs/UX_GUIDE.md`](../UX_GUIDE.md) and the [README](../../README.md). The "Gaps and next priorities" table reflects roadmap thinking at the time and may have moved into GitHub issues since. Preserved here for project archaeology.

---

MSP operators managing a book of business through Pax8 have a handful of recurring workflows that drive their revenue: monitoring the health of their portfolio, catching billing errors, acting on growth opportunities, and staying ahead of renewals. The Pax8 API provides the raw data to support all of these, but not the answers — the gap between "here are your subscriptions" and "here's who's about to churn" is filled by manual portal work, spreadsheets, or nothing at all.

What follows are those core workflows, what the prototype delivers against each one, and where the gaps remain.

---

## The workflows

### Portfolio health check

A partner managing 50+ customers needs a single-screen answer to "how's my business doing?" — MRR, upcoming renewals, growth opportunities, active trials, recent activity. Today that's a series of portal clicks across multiple pages.

### Customer prioritization

"Which customers need attention today?" Partners need to prioritize across their book — who has coverage gaps, who's underinvesting, where's the easiest MRR to capture. The portal shows individual customer detail but doesn't rank or compare.

### Renewal management

"What's renewing soon and what's at risk?" Revenue defense — catching renewals before they lapse, understanding MRR exposure, knowing which conversations to have this week. There is no renewals endpoint in the Pax8 API today. The data exists across subscriptions (`commitmentTermEndDate`), but nobody's assembling it.

### Billing reconciliation

"Am I being billed correctly?" Overcharges and undercharges hide in the gap between invoice line items and active subscription quantities. Finding them manually means pulling invoices, pulling subscriptions, cross-referencing one by one, and doing the math. Most partners never do this — the discrepancies just accumulate.

### Growth identification

"Where should I be selling?" Which customers have product gaps, where seat counts are mismatched (100 email seats but 20 backup seats?), and what the MRR opportunity looks like — without manually auditing every account.

### Acting on recommendations

Identifying a gap is only half the job. The partner still needs to place the order — and the context switch from "I see the opportunity" to "let me go find this product in the portal, configure it, and submit" is where momentum dies.

### Revenue reporting

MRR by customer, ARR projections, growth trends over time. The numbers a partner brings to a QBR or uses to track their own trajectory. Today it's export-to-Excel-and-pivot.

---

## Prototype coverage

Every command supports `--json` for agent consumption. JSON output includes `nextActions` for tool chaining. All flows verified end-to-end in demo mode (`PAX8_DEMO=1`).

| Workflow | Status | Commands | What the prototype does |
|---|---|---|---|
| Portfolio health check | **Delivered** | `pax8 status` | One command, one screen. `nextActions` enables agent follow-up. |
| Customer prioritization | **Delivered** | `companies list --coverage`, `companies more` | Scores customers on category coverage (N/7), flags gaps, estimates MRR uplift per company. |
| Renewal management | **Delivered** | `subscriptions renewals` | Computed from scratch — no API endpoint exists. Sorts by urgency, shows MRR at risk. |
| Billing reconciliation | **Delivered** | `invoices audit` | Encodes 13+ API calls into one command. Returns each discrepancy with dollar impact. |
| Growth identification | **Delivered** | `recommendations list` | Cross-sell gaps, seat mismatches, estimated uplift, ready-to-execute order commands. |
| Acting on recommendations | **Delivered** | `recommendations act` | Closed-loop: reviews recs interactively, shows pricing, places the order on confirmation. |
| Revenue reporting | **Delivered** | `report mrr`, `report growth` | MRR by company with projected ARR. Monthly trend with growth percentages. |

Worth noting: the recommendations → order flow is where the prototype goes beyond analytics into closed-loop workflow. Most tools in this space stop at the insight. `recommendations act` identifies the gap, shows the partner exactly what it will cost, and places the order. That's the kind of capability that changes how a partner thinks about the tool — it's not a dashboard, it's an operating surface.

---

## Gaps and next priorities

| Workflow | Status | Why it's next |
|---|---|---|
| Churn risk scoring | **Not started** | The pieces exist — renewals, billing anomalies, seat trends — but there's no unified signal. This connects "this renewal is coming up" with "this customer is showing warning signs." Highest-value extension of what's already built. |
| Bulk operations | **Not started** | "Apply this recommendation across all companies matching X." Extends the recommendations → order flow from single-customer to portfolio scale. |
| Export to CSV/PDF | **Not started** | Partners hand things to clients and accountants. Natural extension of reporting. |
| Alerting / webhooks | **Not started** | "Tell me when a renewal is 30 days out." Moves renewal and billing workflows from pull to push. Bigger lift — requires a persistent process or integration point. |
| MCP server for recommendations | **Blocked — Pax8 API** | The recommendations flow is CLI-only today because the Pax8 API doesn't expose a recommendations endpoint. Once it does, this becomes an MCP tool with typed schemas — agents call it directly rather than through the CLI. |

---

## Agent consumption

Every workflow above works identically for a human at the terminal and an AI agent calling it programmatically — `--json`, `nextActions`, structured errors with recovery suggestions in the Claude skill. An agent conversation that would otherwise require 13+ API calls, pagination logic, and reimplemented business logic becomes: run the command, read the JSON, follow `nextActions`. And the more interesting capabilities on the roadmap — churn risk scoring, alerting — are the ones where an agent doesn't just run commands faster, it runs them *before the partner thinks to ask*.

One thing we haven't built yet: agent-initiated orders. Today `recommendations act` is human-in-the-loop — the partner confirms each order interactively. That's the right starting point. The interesting next step is CIBA (Client-Initiated Backchannel Authentication) — an OAuth 2.0 flow where the agent constructs the order, pushes an approval request to the partner's device, and the partner's authorization is cryptographically bound to that exact change. The agent can't alter the order after approval, not even by a single seat. It's a stronger model than a simple `--confirm` flag because the approval is out-of-band, scoped to the exact payload, and cryptographically verifiable — not just "the agent says the user said yes." This is also a natural place to experiment with approval thresholds: orders under $X go through automatically, orders above require CIBA sign-off. For the full API → CLI → Skill → MCP progression and where this fits, see the [main proposal](./proposal.md).
