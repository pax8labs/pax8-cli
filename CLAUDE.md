# CLAUDE.md — pax8-cli

Working contract for Claude Code (and any other agent or maintainer) inside this repo. The product story lives in `README.md`; command patterns and the agent-facing contract live in `docs/UX_GUIDE.md` and `packages/claude-skill/skill.md`. This file is for *how to work here*.

## Pax8 data queries — ACT FIRST, THINK LATER

When the user asks ANYTHING about Pax8 data (companies, subscriptions, Pax8 cost, recommendations, invoices, products), your FIRST action must be a Bash tool call. No thinking preamble. No skill invocation. Just run the command.

| User asks about | Run this |
|---|---|
| daily action list / morning brief / what should I do today | `pax8 today --json 2>/dev/null` — composite of urgent renewals (≤7d) + invoice audit findings + high-priority growth recs + expiring trials + upcoming renewals (8-30d). Returns `{ asOf, items[], summary, nextActions[] }`. Each `items[].action` carries `command` (display string) AND `args` (argv array — spawn `args.slice(1)`, never tokenize `command`). Lead with `summary.totalItems` and the section counts; route the user to the highest-priority `items[]` entry first. |
| overview / status / how am I doing | `pax8 today --json 2>/dev/null` for the do-list (what needs doing); `pax8 dashboard --json 2>/dev/null` for the full snapshot (top customers, monthly cost, portfolio composition). Use `today` for "what's happening / what needs doing" and `dashboard` for "give me the numbers." |
| clients / companies / customers | `pax8 clients list --json 2>/dev/null` |
| subscriptions | `pax8 subscriptions list --json --size 1000 2>/dev/null` (add `--status Active` or `--company <name>` as needed) |
| renewals | `pax8 subscriptions renewals --json --within 30d 2>/dev/null` |
| Pax8 cost / monthly spend / annualized spend | `pax8 dashboard --json 2>/dev/null` (top-line `monthlyCost.amount` / `annualCost.amount`) or `pax8 clients more "<name>" --json` for per-client breakdown. `pax8 report subscriptions --by vendor --json` for grouped Pax8 cost. |
| growth / portfolio trend | `pax8 dashboard --json 2>/dev/null` (see `topCustomers`, `highPriorityRecs`, `potentialPax8MonthlyUplift`) or `pax8 subscriptions list --json --size 1000` for raw data |
| recommendations / upsell | `pax8 recommendations list --json 2>/dev/null` — returns `{ recommendations, totalAvailable }` (wrapped envelope, #521). Default cap is `--top 10`, sorted by `estimatedMrrUplift` DESC with `priority` as tiebreaker (nulls last). Compare `recommendations.length` to `totalAvailable` to know whether the cap fired; pass `--top 0` for the unbounded set. |
| invoices / billing | `pax8 invoices list --json 2>/dev/null` |
| invoice audit | `pax8 invoices audit --json 2>/dev/null` |
| invoice line items | `pax8 invoices items --invoice-id <invoice-id> --json 2>/dev/null` |
| products / catalog | `pax8 products search "query" --json 2>/dev/null` |
| cost sim / what if / pricing change / SKU swap | `pax8 cost sim --company <name> --product <name> --quantity <n> --json 2>/dev/null` |
| place an order | `pax8 orders create --company <id> --product <id> --quantity <n>` (confirm first) |
| act on a recommendation | Prefer `pax8 recommendations act` for the interactive flow. To act programmatically: read `orderArgs` (an argv array — first element is `"pax8"`) from `pax8 recommendations list --json` and pass `orderArgs.slice(1)` to a subprocess / Bash tool. **Do not pass `orderCommand` to a shell.** It's a display string with raw `companyName` interpolation; #462. Confirm before any write. |
| invoice dispute | `pax8 invoices dispute --discrepancy <id>` (id from `invoices audit`) |
| webhook delivery history | `pax8 webhooks logs <id> --json 2>/dev/null` |
| diagnostics / health | `pax8 doctor --json 2>/dev/null` |

Pax8 cost math (only if you must roll it yourself): monthly term = `price × quantity`; annual term = `price × quantity ÷ 12`; 2-Year = `price × quantity ÷ 24`; 3-Year = `price × quantity ÷ 36`. Group by `companyId`, resolve names from `clients list`. Prefer `dashboard` or `report subscriptions` — they already do this and emit wrapped `monthlyCost` / `annualCost` objects (`{ amount, currency }`) at portfolio, per-customer, and per-group levels. Note: these figures are the partner's COST paid to Pax8, not partner-side resale revenue.

> **List-command JSON envelope (#483).** Every `--json` list command emits a wrapped envelope: `{ <resource>: [...], page: { number, size, totalElements, totalPages } }` (and `nextActions: [...]` when invoked with `--with-actions`). The resource key matches the resource name — `companies` for `clients list`, `subscriptions`, `invoices`, `items` for `invoices items`, `quotes`, `contacts`, `webhooks`, `logs` for `webhooks logs`, `topics`, `products`, `usage`, `renewals` for `subscriptions renewals`, `orders`, `recommendations`. `page.number` is 1-based (matches `--page`). Compare `<resource>.length` to `page.totalElements` to detect pagination — use `--page N --size M` to walk through results. `singlePageEnvelope` is emitted for endpoints without server pagination (webhooks list/logs/topics, usage list, products search, subscriptions renewals).

> **nextActions argv contract (#562).** Each `nextActions[]` entry carries both `command` (display string) and `args` (argv array — first element is always `"pax8"`). **Spawn `args.slice(1)` directly via the Bash tool's argv form; never tokenize `command` and never pipe it to a shell.** Same shape and reasoning as the `orderArgs` / `orderCommand` pair for `recommendations list` (#462). The argv form contains user-supplied flag values (e.g. partner-typed `--product` or `--company`) in single argv slots so shell metacharacters can never break out.

Rules: no clarifying questions. Parallel calls when possible. Lead with the key number. Short tables, hide UUIDs. Only confirm writes — never reads.

> `pax8 clients *` is the canonical (and only) command surface (per #317, #476). The previous `pax8 companies *` alias was removed pre-launch. JSON output fields (`companyId`, `companyName`, etc.) and the `--company` flag on other commands stay aligned with the wire.

The full read-vs-write safety contract for agent-driven sessions lives in `packages/claude-skill/skill.md`. Honor it whether the skill is loaded or not: every command listed under "Write commands" requires explicit user approval before execution.

---

## What is this project?

An open-source CLI for MSPs that turns the Pax8 marketplace API (raw CRUD) into computed answers — renewals, invoice audits, Pax8-cost analytics, upsell recommendations, closed-loop order placement. The durable asset lives in `packages/core` and is interface-agnostic.

For project background, install instructions, the human demo flow, and how this CLI compares to the hosted Pax8 MCP at `mcp.pax8.com`, see `README.md`. Don't restate that here; link.

## Autonomous Build Mode

This mode applies **only** when you're explicitly following `docs/history/BUILD.md` (or a similar mode-specific prompt). Default behavior is conservative — confirm before destructive or shared-state actions and surface uncertainty.

When following `docs/history/BUILD.md`, operate fully autonomously with ZERO human interaction:

- NEVER ask questions, for permission, or for confirmation.
- NEVER stop to explain what you're about to do. Just do it.
- If something breaks, fix it yourself. If a test fails, fix the test or the code.
- If a dependency is missing, install it. If a config is wrong, fix it.
- Commit after every numbered build step. Run `pnpm build && pnpm test` before each commit.
- Go fast. Minimize tool calls. Batch related changes.

## Repo layout

Monorepo with pnpm workspaces:

- `packages/core` — `@pax8/core`. API client, auth, services (renewals, audit, recommendations, Pax8-cost analytics), types. Zero CLI dependencies. Embeddable on its own — see `packages/core/README.md`.
- `packages/cli` — `@pax8/cli`. Commander.js commands, formatting, interactive UX. Imports only from `@pax8/core`.
- `packages/claude-skill` — `@pax8/claude-skill`. Wraps CLI commands as Claude Code tools and ships the agent-facing safety contract (`packages/claude-skill/skill.md`).

Subprocess integration tests live in `packages/cli/src/__tests__/`; they run the built CLI with `PAX8_DEMO=1`. Demo mode is the test posture, not a side project — every command must work end-to-end under it.

## Developer commands

```bash
pnpm install                                            # Install all dependencies
pnpm build                                              # Build all packages
pnpm test                                               # Run all tests (vitest)
pnpm test packages/cli/src/__tests__/invoices.test.ts   # Run one test file
pnpm test --run -t "should audit"                       # Run by name pattern
pnpm test:coverage                                      # Coverage report
pnpm lint                                               # Lint all packages
pnpm dev                                                # Run CLI in dev mode (watch)
```

## Conventions

`docs/UX_GUIDE.md` is the canonical reference for command shape, flag vocabulary, output contracts, error handling, spinners, confirmation prompts, pagination, demo mode, and the agent-facing contracts (machine-readable error codes, idempotency keys, `nextActions`, signal handling). **Read it before adding or modifying any command** and use the §13 checklist before opening a PR.

Operating principles you'll feel everywhere — stated so they're not implied:

- **Reads are free; writes are deliberate.** Reads never prompt. Writes always prompt unless the user passes `-y` / `--yes` or sets `PAX8_YES=1`, accept `--idempotency-key <uuid>`, and call `markWriteInFlight()` so SIGINT can log the in-flight key.
- **Stdout is data, stderr is everything else.** A `pax8 ... --json | jq` pipeline must never see a spinner, hint, or banner. Use `output()` from `packages/cli/src/lib/output.ts`; never `console.log`.
- **Demo mode is the test posture.** `PAX8_DEMO=1` swaps in `MockPax8Client`. Every command must work under it; CI fails otherwise. Don't branch on `process.env.PAX8_DEMO` in command code — go through `buildContext()`.
- **Errors carry codes.** Throw `CliError` with one of the `ERROR_*` constants from `@pax8/core` (`packages/core/src/errors/codes.ts`). Codes are append-only — never repurpose. `--json` mode serializes errors as structured objects on stderr.
- **No invented synonyms.** If the concept exists in the §2 flag table of `docs/UX_GUIDE.md`, use that flag. Kebab-case for flags, `PAX8_<SCREAMING_SNAKE>` for env vars.
- **SIGINT exits 130.** Active spinners stop cleanly without `✗`. Writes log `(cancelled)` with the idempotency key if any.
- **Conventional Commits + DCO sign-off.** Every commit uses `git commit -s` and a Conventional Commits subject; PRs without sign-off get bounced. See `CONTRIBUTING.md` for the full DCO policy.

Adding a new command? Lives at `packages/cli/src/commands/<resource>/<action>.ts`, registered in `<resource>/index.ts`, gets a subprocess test in `packages/cli/src/__tests__/`, and conforms to `docs/UX_GUIDE.md` §13.

## Environment variables

- `PAX8_CLIENT_ID`, `PAX8_CLIENT_SECRET` — credentials (file fallback: `~/.pax8/credentials.json`)
- `PAX8_API_BASE` — override API + token base URL (e.g. staging); honored by both `@pax8/core` and the OAuth client
- `PAX8_TIMEOUT_MS` — per-request HTTP timeout in milliseconds (default `30000`, max `300000`); extend for slow endpoints like `/orders` on large portfolios (#199)
- `PAX8_DEMO=1` — run against `MockPax8Client` with synthetic data. Defaults to the hand-curated small fixture (~12 companies, dozens of subs/orders) suitable for screenshots and golden-path tests.
- `PAX8_DEMO_SCALE=large` — when combined with `PAX8_DEMO=1`, swaps in the generated large-portfolio fixture (#484): 1,000 companies, 5,000 subscriptions, 45,000 orders dating back to 2013, mixed currencies (USD/EUR/GBP/CAD), every `BillingTerm` value, plus shell-meta-hostile customer names for `orderCommand` regression-testing. Pay ~400ms at process start; intended for scale-matrix testing, not daily use.
- `PAX8_YES=1` — auto-confirm write prompts
- `PAX8_QUIET=1` — disable spinners
- `PAX8_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1` — opt out of telemetry (already opt-in by default)

## References

- `README.md` — what the project is, install/quick-start, MCP comparison
- `docs/UX_GUIDE.md` — command patterns, output contracts, agent-facing rules (canonical for conventions)
- `docs/PRD.md` — product requirements and API gap analysis
- `docs/history/BUILD.md` — autonomous build-mode execution plan
- `packages/core/README.md` — `@pax8/core` as a standalone embeddable library
- `packages/claude-skill/skill.md` — agent-facing skill manifest + read/write safety contract
- `CONTRIBUTING.md` — DCO sign-off, Conventional Commits, PR workflow
- Pax8 API: `https://api.pax8.com/v1/`, OAuth at `POST /v1/token`, 1,000 req/min, docs at `https://devx.pax8.com/`
