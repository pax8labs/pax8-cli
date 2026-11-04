# Pax8 Marketplace CLI Proposal

> **Historical document.** This is the pre-launch proposal that motivated `pax8-cli`, drafted before the public repo existed. The "prototype" it describes is what shipped as v0.1.0 — for what the tool actually does today, see the [README](../../README.md). The bets, open questions, and surface-comparison framing are preserved here for project archaeology and to document the original strategic intent.

---

## The Opportunity

There is a growing gap between what the Pax8 API provides (raw CRUD operations on subscriptions, invoices, and products) and what MSPs actually need to know (which renewals are at risk, where they're being over-billed, which customers are missing critical products, what their MRR looks like by customer). That gap is currently filled by manual portal work, spreadsheets, or nothing at all.

Agents make this gap more consequential. As MSPs adopt AI assistants (Claude Code, Cursor, Copilot), those agents inherit the same limitation: the API gives them raw data, and they have to re-derive business logic every conversation. Whoever provides the computed, business-logic layer that partners and their agents call is positioned to become the default workflow surface for MSP operations. We see this an opportunity to meet users where they are.

## Who This Serves

Many MSP operators manage multiple customers and are time-constrained; they don't have time to log into the portal, click through each account, and mentally cross-reference renewals against invoices against subscription gaps. The prototype meets them in the terminal with the answers already computed which provides a delightful experience for someone who lives in the terminal to do their job.

Those same terminal commands make AI agents faster and more reliable. An agent calling the raw API would need to reinvent all of the business logic above every conversation, burning tokens on pagination, grouping, and date math, and likely getting edge cases wrong. The prototype encodes the correct logic once and returns the answer.

## The Prototype

We have a working pax8 marketplace CLI that demonstrates this computed layer. Architecturally, the engine (`packages/core`) is a standalone library with zero CLI dependencies. The CLI and a Claude skill are two separate interfaces to the same logic: one for humans, one for agents. Every command supports `--json` for machine consumption.

The prototype covers 7 core partner workflows — from portfolio health checks and billing reconciliation to a closed-loop recommendations → order flow that identifies gaps *and* places the order. It also computes renewals from scratch (no renewals endpoint exists in the API) and MRR/ARR analytics across the full book of business. For the full workflow mapping and coverage status, see [Key Partner Workflows](./workflows.md).

Future work: integrate with forthcoming OpEx recommendations via MCP when it launches.

The prototype ships with a demo mode (`PAX8_DEMO=1`) that runs against synthetic data, so anyone can evaluate it without API credentials.

## Under the hood

With the prototype:

```
pax8> pax8 invoices audit --json
  ✨ Demo mode — showing sample data
[
  {
    "discrepancies": [
      {
        "companyId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "companyName": "Summit Healthcare Partners",
        "productName": "Microsoft 365 Business Premium [New Commerce Experience]",
        "invoicedQuantity": 95,
        "activeQuantity": 85,
        "delta": 10,
        "dollarImpact": 220,
        "type": "overcharge"
      },
      ...
    ]
  }
]
```

This one command returns every billing discrepancy with dollar impact — overcharges, undercharges, missing line items.

The recommendations flow goes further. `pax8 recommendations list` identifies cross-sell gaps and seat mismatches with estimated MRR uplift. `pax8 recommendations act` walks through them interactively and places the order on confirmation. Most tools stop at the insight — this one closes the loop.

With the raw APIs, the same question takes 13 API calls for 10 invoices (one for auth, one for invoices, one for subscriptions, and one per invoice to fetch line items - there's no bulk endpoint today). Then you still need to build a subscription index, match each line item to its subscription, compare quantities, classify deltas (overcharge, undercharge, unexpected, missing), calculate dollar impact, and sum it all up. And then test it for accuracy. That's a big lift for someone handy with curl, and it's slow and token-heavy for an agent.

And when it comes to agents, the CLI is the minimum viable layer. A Claude Skill teaching an agent which commands to run and when eliminates discovery overhead entirely to enable the agent to go from "figure out the Pax8 API" to "run the audit, cross-reference with renewals, flag churn risks" in a single conversation. An MCP server adds structured input/output contracts for higher reliability at scale. The progression is: raw API (possible but expensive) → CLI (correct logic, encoded once) → Skill (correct workflow, zero discovery) → MCP server (structured contracts, lowest failure rate). Each layer reduces the cost of the next question a partner asks, though as models improve at consuming APIs directly, some of these layers may compress or become unnecessary. The durable asset is the domain knowledge: which questions to ask, what the answers mean, and what to do next — not necessarily the code that computes it or the specific interface. Timelines on when the progression above collapses are speculative at best, but it is clear that in the short to medium term the progression likely holds. And as agents move from read-only queries toward placing orders, CIBA (Client-Initiated Backchannel Authentication) provides the trust model — the partner's approval is cryptographically bound to the exact change, so the agent can't alter it after sign-off. See [Key Partner Workflows](./workflows.md) for more on the agent-initiated order flow.

## The Open Source Approach

Open source gets real MSPs running the prototype against real data without a sales cycle. That does two things: it validates which computed capabilities are worth investing in further, and it builds credibility with Microsoft (and other AI platform vendors) that Pax8 is serious about the developer and agent ecosystem.

## Hypotheses and What to Watch For

This proposal has one core bet: **a meaningful number of Pax8 partners will use a CLI tool that gives them billing, renewal, and upsell answers they can't easily get today.**

If that bet pays off, the rest follows naturally — agent consumption, skills, MCP servers, and eventually first-party API endpoints are all distribution strategies on top of proven value. If it doesn't, the investment is bounded: the business logic in `packages/core` is interface-agnostic and ports directly to a portal feature, a web dashboard, an API endpoint, or any other surface.

It's worth being explicit about the secondary bets and what changes if they don't land:

**Bet: partners prefer CLI-based tooling.** PowerShell is the native language of the MSP world — GitHub is full of partner-authored scripts for M365 management, Azure provisioning, and security automation. We're betting that a CLI meets this audience where they already work. But if Pax8 partners turn out to be more portal-native than terminal-native, the CLI doesn't find an audience. What doesn't change: the underlying business logic is the same regardless of interface. We repackage it, not rebuild it. The CLI is the cheapest way to test the value of the computed layer — if the packaging is wrong, we learn that in weeks and redirect.

**Bet: open source is the fastest path to validation.** We believe zero-friction adoption (`npm install`, run against real data, see value in minutes) gets us to signal faster than a managed service or portal feature. If nobody engages with the repo, we still have a working internal tool and the business logic ports to any distribution model.

**Bet: agents will increasingly consume this type of tooling.** As agentic coding goes mainstream, the same computed layer that serves human CLI users becomes the default surface agents call. If agent adoption among MSPs is slower than expected, the CLI still serves the scripting audience. Agent adoption is upside, not a prerequisite — but it's significant upside: whoever's patterns are in the skill libraries wins the default position.

## Over time: where to invest

Most SaaS companies never build a CLI. The typical path is API → web app, and for good reason — the majority of users live in a browser. But the Pax8 partner audience is different. MSPs are operational people who manage infrastructure through scripts, terminals, and increasingly through AI agents. PowerShell is their native language — GitHub is full of MSP-authored repos covering M365 management, Azure provisioning, and security automation. For this audience, a CLI isn't an unusual investment. It's meeting them where they already work.

The more novel argument is that a CLI is also the fastest way to learn. A web app takes months to ship and each iteration goes through design, frontend, backend, deploy. Due to its natural, forcing constraints, a CLI capability takes weeks, and usage data tells you immediately what's valuable. In a space where we're still discovering which computed capabilities partners actually need, that speed matters more than polish.

The question isn't which interface to build — it's which to build first, and how each one informs the next. Usage patterns from the CLI tell you what's worth investing in next: if 80% of partners run `invoices audit`, that's a signal for where to build a skill, then an MCP server, then maybe a dashboard or a first-party endpoint. Power users will generally want the long tail of commands and composability that a terminal provides, but those features will not always be warranted for the gen-pop in a GUI. But the capabilities that cluster around broad, repeated use are strong candidates for building into a web-app. Each interface is faster and cheaper to justify when the previous one has already validated demand.

| Surface | Consumer | Build cost | Maintenance | Time to first value | Value created |
|---|---|---|---|---|---|
| Raw API | Developers, scripts | Already exists | Pax8 owns it | — | Data, not answers. Agent reimplements business logic every session. |
| CLI | Power users, agents | 2-4 weeks per capability | Low — ship updates, no versioning contract | Days (open source, `npm install`) | Correct answers, encoded once. Validates which capabilities matter. |
| Claude Skill | Agents | Hours per workflow | Minimal — update when CLI changes | Minutes (drop into agent config) | Zero-discovery agent access. Encodes "what to do next," not just "what command to run." |
| MCP server | Agents | 2-4 weeks | Medium — typed schemas are a contract | Days (install, configure) | Structured reliability. Agents call typed tools, not parse terminal output. |
| Web app | Non-technical operators | Months | High — frontend, hosting, auth, UX | Weeks (deploy, onboard users) | Reaches non-technical operators. Only worth it for capabilities with proven, broad demand. |
| First-party API endpoint | Everyone | Months | High — versioned, backwards-compatible | Weeks (API release cycle) | Server-side computation, universal access. Graduation ceremony for proven capabilities. |

CLI-side logic is valuable in discovery mode. As capabilities stabilize and demand concentrates, the winners graduate to maintained endpoints. The CLI continues as the more composable and expressive surface for agents and power users, and as the R&D layer where the next generation of capabilities gets prototyped, including by outside open source contributors and by agents themselves, before anyone commits to an API contract.

## Open Questions

* Which computed capabilities are highest-signal for promotion to first-party endpoints?
* Do we eventually invest in a hosted version (MCP server, API gateway) vs. CLI-only distribution?
* What does adoption look like that tells us this is working? Number of MSPs, command frequency, someone building a workflow on top of it? What's the threshold that justifies further investment?
* How do we formalize the feedback loop from CLI usage data to the product roadmap?

## See also

* [Pax8 Marketplace CLI — Key Partner Workflows](./workflows.md)
