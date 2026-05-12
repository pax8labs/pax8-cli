# AGENTS.md — pax8-cli

`pax8` is an open-source CLI that turns the Pax8 marketplace API (raw CRUD) into computed answers — renewals, invoice audits, MRR analytics, upsell recommendations, and closed-loop ordering — with structured `--json` on every command.

This file is for any AI agent or automation runtime that wants to use the `pax8` CLI: Cursor, aider, OpenCode, Continue, scripted Anthropic / OpenAI-API agents, CI bots, anything that can run a shell command. Claude Code users can also load `packages/claude-skill/skill.md` directly — it carries the same contract with Claude-specific framing.

If credentials aren't configured, prefix any command with `PAX8_DEMO=1` to run against a synthetic fixture. Run `pax8` from PATH directly — never `node packages/cli/dist/index.js` or `pnpm dev`. The CLI is the source of truth: it computes renewals, audits invoices, and ranks recommendations, so don't reimplement that logic.

## ACT FIRST — pick the right command and run it

When asked anything about Pax8 data, your first action should be a shell call. No preamble, no clarifying questions, no "let me check." Pick the row, run the command, then narrate the answer.

| Question | Run this |
|---|---|
| overview / status / how am I doing | `pax8 dashboard --json 2>/dev/null` |
| clients / companies / customers | `pax8 clients list --json 2>/dev/null` |
| subscriptions | `pax8 subscriptions list --json --size 1000 2>/dev/null` (add `--status Active` or `--company <name>` as needed) |
| renewals | `pax8 subscriptions renewals --json --within 30d 2>/dev/null` |
| MRR / revenue | `pax8 report mrr --json 2>/dev/null` (or `pax8 subscriptions list --json --size 1000` AND `pax8 clients list --json` in parallel) |
| growth trend | `pax8 report growth --json 2>/dev/null` |
| recommendations / upsell | `pax8 recommendations list --json 2>/dev/null` |
| invoices / billing | `pax8 invoices list --json 2>/dev/null` |
| invoice audit | `pax8 invoices audit --json 2>/dev/null` |
| invoice line items | `pax8 invoices items --invoice-id <invoice-id> --json 2>/dev/null` |
| products / catalog | `pax8 products search "<query>" --json 2>/dev/null` |
| cost sim / what-if / SKU swap / pricing change | `pax8 cost sim --company <name> --product <name> --quantity <n> --json 2>/dev/null` |
| place an order | `pax8 orders create --company <id> --product <id> --quantity <n>` (confirm first) |
| act on a recommendation | Extract `orderCommand` from `pax8 recommendations list --json` and run it (confirm first), or use `pax8 recommendations act` for the interactive flow |
| invoice dispute | `pax8 invoices dispute --discrepancy <id>` (id from `invoices audit`) |
| webhook delivery history | `pax8 webhooks logs <id> --json 2>/dev/null` |
| diagnostics / health | `pax8 doctor --json 2>/dev/null` |

MRR math (only if you must roll it yourself): monthly term = `price × quantity`; annual term = `price × quantity ÷ 12`. Group by `companyId`, resolve names from `clients list`. Prefer `report mrr` — it already does this.

Operating principles:

- **No clarifying questions.** Use sensible defaults: all companies, current month, 30-day renewal window, top 10 results.
- **Parallel fetches.** When you need two independent calls (e.g. subs + companies), run them in parallel.
- **Resolve names, hide UUIDs.** Display company and product names; only show IDs if asked or if needed for a follow-up command.
- **Lead with the number.** Total MRR, count of renewals, dollar impact — at the top. Top 3-5 rows, not every row.
- **Only confirm writes — never reads.**

## Safety contract: read-only vs. write commands

Read-only commands run autonomously. Write commands require explicit approval before execution.

### Read-only commands — run autonomously (no confirmation)

These never mutate state. Run them freely, in parallel, and as often as needed.

- `pax8 *list` — `clients list`, `subscriptions list`, `invoices list`, `orders list`, `recommendations list`, `products list`, `quotes list`, `webhooks list`, `usage list`, `contacts list`
- `pax8 *show <id>` — every show command across every resource
- `pax8 products search`
- `pax8 report mrr`, `pax8 report growth`
- `pax8 clients more <name>` — rich read-only summary
- `pax8 subscriptions renewals` — computes renewals from existing data
- `pax8 invoices items` — line items for an invoice
- `pax8 invoices audit` — read-only computation, no writes
- `pax8 cost sim` — what-if pricing simulation, no writes
- `pax8 dashboard`, `pax8 dashboard --all|--renewals|--growth|--customers`
- `pax8 doctor` — diagnostics only
- `pax8 webhooks logs <id>` — delivery history (read-only)

### Write commands — confirm first

For every write command below:

1. **Surface exactly what will change** — the command about to run, the affected resource(s), and the expected effect (price, quantity, MRR delta, etc. when applicable).
2. **Wait for explicit approval** — a clear "yes / go ahead / do it" from the operator your runtime is serving. Don't infer approval from earlier conversation, and don't run the write while still asking.
3. **Run the command without `--yes` by default** so the CLI's own confirmation prompt is also surfaced. Pass `--yes` only when this exact action has already been approved.

Write commands:

- `pax8 recommendations act` — places real orders. Always interactive; only invoke during a human-in-the-loop session.
- `pax8 invoices dispute` — files a billing dispute against a discrepancy.
- `pax8 orders create` — places a real order, charges the partner, creates a subscription.
- `pax8 clients create`, `pax8 clients update` — partner-account-level customer-record changes.

> `pax8 clients *` is the canonical command surface. `pax8 companies *` is retained as an indefinite deprecated alias — both invocations share the exact same command graph, so agents can use either form. JSON output fields (`companyId`, `companyName`, etc.) and the `--company` flag on other commands stay aligned with the wire.
- `pax8 contacts create`, `pax8 contacts update`, `pax8 contacts delete` — modifies customer contacts.
- `pax8 quotes create`, `pax8 quotes update`, `pax8 quotes delete` — modifies sales quotes.
- `pax8 subscriptions update`, `pax8 subscriptions cancel` — changes seat counts, billing terms, or terminates a subscription.
- `pax8 webhooks create`, `pax8 webhooks delete`, `pax8 webhooks test` — modifies subscription endpoints / sends real test deliveries to partner-controlled URLs.
- **Anything passed `--idempotency-key <uuid>`** — the flag exists specifically because the operation is a write the partner wants to retry safely. Treat as write regardless of which subcommand carries it.

If unsure whether a command counts as a write, default to confirming. Better one extra prompt than one unintended order.

## Output flags

| Flag | When to use |
|---|---|
| `--json` | Default for agents. Parse it. List commands return flat arrays. |
| `--csv` | When the operator asks for a spreadsheet, export, or PSA import. |
| `--quiet` | Suppress output entirely (rare; mostly for write commands you're chaining). |
| `--ids-only` | Pipe one command's output into another's `--company` filter. |
| `--with-actions` | Wrap list-command JSON as `{ items, nextActions }` so suggested next commands ride along. Available on `recommendations list`, `subscriptions renewals`, `webhooks list`, `webhooks logs`. Single-object commands (`dashboard`, `report mrr/growth`, `invoices audit`) always include `nextActions` inline. |

## Result size

List commands default to `--size 25`. For portfolio-wide analysis (MRR, audits, recommendations) use `--size 1000`. Don't fetch 1000 if the operator asked for "top 5."

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
pax8 clients list --json
```
For each rec, show: company, missing product, estimated MRR uplift. The JSON output includes an `orderCommand` field — that's the exact `pax8 orders create …` to run. **Always show the order preview and wait for explicit approval before executing the write.**

### Portfolio MRR
Run in parallel:
```
pax8 report mrr --json
pax8 clients list --json
```
`report mrr` already breaks down by company. Lead with total MRR and top 5 customers; offer per-vendor or per-product breakdown if asked.

### "What if?" — cost simulation
```
pax8 cost sim --company "<name>" --product "<name>" --quantity <n> --json
```
Use for SKU swaps (`--from "<current sku>"`), quantity changes (omit `--from`; the CLI auto-detects the existing subscription), or add-new (no current subscription). Lead with the delta number — "+$N/mo" or "−$N/mo" — and mention the per-seat impact when seats are unchanged. Read-only; no order is placed.

### "Who's missing X?" (cross-sell)
```
pax8 recommendations list --json --product "<name>"
```
Filter by product (e.g. `"backup"`, `"AvePoint"`, `"Entra"`). Returns ranked customers with estimated uplift and ready-to-run order commands.

## Falling back to raw data

The recipes above cover the questions the CLI is opinionated about. For novel questions (custom analytics, ad-hoc joins, "show me all subscriptions ending in Q3 grouped by vendor"), use the raw list commands and assemble the answer yourself with `jq`:

```
pax8 subscriptions list --json --size 1000
pax8 invoices list --json
pax8 clients list --json
```

Don't reimplement what's already a first-class command (renewals, audit, recommendations, MRR) — those exist precisely because they're hard to get right from the raw shape.

## Error and edge cases

Errors emitted under `--json` are structured envelopes on stderr with a stable `code` field — one of the `ERROR_*` constants in [`packages/core/src/errors/codes.ts`](packages/core/src/errors/codes.ts). Branch on the code, not the message string.

- **Auth not configured** (`ERROR_AUTH_MISSING`, `ERROR_AUTH_EXPIRED`, or HTTP 401): report that credentials are missing or expired and recommend `pax8 auth login` or setting `PAX8_CLIENT_ID` / `PAX8_CLIENT_SECRET`. Don't retry blindly.
- **No data to explore?** Suggest `PAX8_DEMO=1 pax8 <command>` for sample data.
- **Empty results** (e.g. `renewals --within 7d` returns `[]`): report it plainly ("no renewals in the next 7 days"). Don't fabricate rows. Offer to widen the window.
- **Rate limit** (`ERROR_RATE_LIMITED`, HTTP 429): pause, summarize what you got, and surface the limit. Don't hammer.
- **Diagnostic before giving up.** If something feels off (stale cache, weird timeouts, auth issues), `pax8 doctor` is the one-shot health check. Don't run it preemptively.
- **Ambiguous company/product names.** When given a partial name, pass it through — the CLI resolves fuzzy matches and errors clearly (`ERROR_COMPANY_NOT_FOUND`, `ERROR_PRODUCT_NOT_FOUND`) when it can't.
- **Cold API (~30s).** First call after idle can be slow. Don't time out; don't retry in parallel.

## Discovery for self-aware agents

The CLI is self-describing — agents that want to enumerate their own surface should prefer these over hardcoding:

- `pax8 --help` — top-level resource and command listing.
- `pax8 <resource> --help` and `pax8 <resource> <action> --help` — per-command flag and argument detail.
- `pax8 doctor --json` — environment, auth, API reachability, cache, and telemetry state in a single structured payload. Use it as a one-shot health check, not a per-call probe.
- `pax8 dashboard --json` — portfolio snapshot (MRR, renewals, recs, trials) with `nextActions` inline.

A first-class `pax8 agents` command — emitting a machine-readable inventory of every command, flag, error code, and read/write classification — is planned for v0.2.x as part of the canonical-source-of-truth refactor (#164). Until that lands, parse `--help` output or read this file.
