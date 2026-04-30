---
name: pax8
description: Manage Pax8 cloud marketplace operations — query customers, subscriptions, invoices, renewals, and products
---

You have access to the `pax8` CLI on PATH. Run it directly via Bash — never `node packages/cli/dist/index.js` or `pnpm dev`. The CLI is the source of truth: it computes renewals, audits invoices, and ranks recommendations server-side, so you should not reimplement that logic.

## Behavioral rules

- **Act first.** Your first response must include the right `pax8` command. No preamble, no "let me check."
- **No clarifying questions.** Use sensible defaults: all companies, current month, 30-day renewal window, top 10 results.
- **Parallel fetches.** When you need two independent calls (e.g. subs + companies), run them in parallel.
- **Read-only is free.** Never confirm before listing/showing/auditing. Always confirm before `orders create`, `subscriptions update`, or `subscriptions cancel`.
- **Resolve names, hide UUIDs.** Display company and product names; only show IDs if the user asked or if needed for a follow-up command.
- **Order previews are mandatory.** Run `orders create` without `--yes` so the user sees price/total/MRR before confirming. Pass `--yes` only when the user has already approved this specific order.
- **Lead with the number.** Total MRR, count of renewals, dollar impact — top of the response. Top 3-5 rows, not every row.

## Output flags

| Flag | When to use |
|---|---|
| `--json` | Default. You parse it. |
| `--csv` | User asks for a spreadsheet, export, or PSA import. |
| `--quiet` | Suppress output entirely (rare; mostly for write commands you're chaining). |
| `--ids-only` | Pipe one command's output into another's `--company` filter. |

Pagination: most list commands default to `--size 25`. Use `--size 1000` for portfolio-wide analysis (MRR, audits, recs). Don't fetch 1000 if the user asked for "top 5."

## Commands

```
pax8 status [--all|--customers|--renewals|--growth] --json
pax8 companies list --json
pax8 companies show <id|name> --json
pax8 companies more <name>                                  # rich summary, table only
pax8 subscriptions list --json --size 1000 [--company <id|name>] [--status Active|Trial|Cancelled]
pax8 subscriptions show <id> --json
pax8 subscriptions renewals --json --within 7d|30d|90d [--company <id|name>]
pax8 invoices list --json [--company <id|name>] [--status Paid|Unpaid]
pax8 invoices audit --json [--month YYYY-MM] [--company <id|name>]
pax8 products search "<query>" --json
pax8 recommendations list --json [--priority high|medium|low] [--company <id|name>] [--product <name>]
pax8 recommendations act [--company <id|name>] [--product <name>]    # interactive — only for human-in-the-loop sessions
pax8 orders list --json
pax8 orders create --company <id|name> --product <id|name> --quantity <n> [--billing-term Monthly|Annual]
pax8 report mrr --json
pax8 report growth --json
pax8 doctor                                                  # diagnostics, not for data
```

## MRR math

The CLI computes MRR for you in `pax8 status`, `pax8 report mrr`, and `pax8 companies more`. Prefer those over hand-rolling it. If you must compute from `subscriptions list`:

- Monthly billing term → `price × quantity`
- Annual billing term → `price × quantity ÷ 12`
- Group by `companyId`; resolve names from `companies list`.

## Workflow recipes

### Renewal triage
```
pax8 subscriptions renewals --json --within 30d
```
Sort by `daysUntilRenewal` ascending. Lead with count + total MRR at risk. Show top 5 (company, product, days, MRR). Offer to drill into any one with `pax8 subscriptions show <id> --json`.

### Invoice audit → action
```
pax8 invoices audit --json
```
Group discrepancies by category (overcharge, undercharge, orphan line item). Lead with total dollar impact. For each top finding, name the company/product and the dollar delta. Suggest `pax8 invoices audit --company "<name>" --json` for a deeper dive on the worst offender.

### Recommendation → order
Run in parallel:
```
pax8 recommendations list --json --priority high
pax8 companies list --json
```
For each rec, show: company, missing product, estimated MRR uplift. The JSON output includes an `orderCommand` field — that's the exact `pax8 orders create …` to run. **Always show the user the order preview and wait for explicit approval before executing the write.**

### Portfolio MRR
Run in parallel:
```
pax8 report mrr --json
pax8 companies list --json
```
`report mrr` already breaks down by company. Lead with total MRR and top 5 customers; offer per-vendor or per-product breakdown if the user asks.

### "Who's missing X?" (cross-sell)
```
pax8 recommendations list --json --product "<name>"
```
Filter by product (e.g. `"backup"`, `"AvePoint"`, `"Entra"`). Returns ranked customers with estimated uplift and ready-to-run order commands.

## Error and edge cases

- **Auth not configured** (`401`, "credentials missing", or empty token errors): tell the user to run `pax8 auth login` or set `PAX8_CLIENT_ID` / `PAX8_CLIENT_SECRET`. Don't retry blindly.
- **No data to explore?** Suggest `PAX8_DEMO=1 pax8 <command>` so they can try with sample data.
- **Empty results** (e.g. `renewals --within 7d` returns `[]`): say so explicitly ("no renewals in the next 7 days"). Don't fabricate rows. Offer to widen the window.
- **Rate limit** (429): pause, summarize what you got, and surface the limit to the user. Don't hammer.
- **Diagnostic before giving up.** If something feels off (stale cache, weird timeouts, auth issues), `pax8 doctor` is the one-shot health check. Don't run it preemptively.
- **Ambiguous company/product names.** When the user gives a partial name, pass it through — the CLI resolves fuzzy matches and errors clearly if it can't.
- **Cold API (~30s).** First call after idle can be slow. Don't time out; don't retry in parallel.
