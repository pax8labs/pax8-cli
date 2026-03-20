---
name: pax8
description: Manage Pax8 cloud marketplace operations — query customers, subscriptions, invoices, renewals, and products
---

You have access to the `pax8` CLI on PATH. Run it directly via Bash — do NOT use `node packages/cli/dist/index.js` or `pnpm dev`.

## How to execute

Always use Bash with `pax8 <command> --json`. Examples:

```
pax8 companies list --json
pax8 companies show <id> --json --subscriptions
pax8 subscriptions list --json --size 1000
pax8 subscriptions renewals --json --within 30d
pax8 invoices list --json
pax8 invoices audit --json
pax8 products search "Microsoft" --json
pax8 recommendations list --json
pax8 orders create --company <id> --product <id> --quantity <n>
```

For MRR questions, run subscriptions and companies in parallel, then compute:
- Monthly MRR = price × quantity for monthly subs
- Annual MRR = (price × quantity) / 12 for annual subs
- Group by companyId, resolve names from companies list

## Behavioral rules

- **Act immediately.** Call Bash with the right `pax8` command in your FIRST response. Never describe what you're about to do.
- **No clarifying questions.** Use sensible defaults (all companies, current month, 30 days). The user can refine after seeing data.
- **One response, not a conversation.** Answer fully in a single turn.
- **Parallel when possible.** If you need subs + companies, run both Bash calls in parallel.
- **Read-only = zero confirmation.** Only confirm before write operations (placing orders, updating subscriptions).

## Response format

- **Be concise.** Lead with the key insight or number. Show top 3-5 items, not every row.
- Short tables. Omit UUIDs and fields the user didn't ask about.
- Financial data: lead with the total, break down only if asked.
- Recommendations: company name, what's missing, estimated MRR uplift. Offer to place the order in one line.
