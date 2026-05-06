# pax8-cli

An open-source CLI for managing Pax8 cloud marketplace operations. Built for MSPs who want to manage subscriptions, billing, customers, and growth opportunities from the terminal.

## Status

This is an early-stage open-source experiment. We're using engagement signals (installs, issues, command usage) to learn which capabilities are worth investing in further. Feedback, issues, and PRs are welcome.

## Highlights

- **Answers the API doesn't** — renewals, invoice audit, upsell recommendations, MRR analytics computed locally from raw Pax8 data
- **Closes the loop** — `pax8 recommendations act` walks portfolio gaps and places the orders, so insight and action live in the same tool
- **Works for humans and agents identically** — every command emits structured JSON, so a Claude Code skill, a shell pipeline, or a person at a terminal all use the same surface
- **Demo mode** — `PAX8_DEMO=1` runs every command against an in-memory fixture, no credentials required

## Why This Exists

The Pax8 API is a CRUD layer — it returns raw subscriptions, invoices, and products. It doesn't answer the questions MSPs actually ask: *Which renewals are coming up? Am I being overbilled? Which customers are missing backup?*

This CLI computes what the API doesn't:

- **Renewal tracking** — no renewals endpoint exists; the CLI parses commitment dates, calculates estimated MRR at risk, and sorts by urgency
- **Invoice auditing** — cross-references invoice line items against active subscriptions to flag overcharges and undercharges with dollar impact
- **Upsell recommendations** — analyzes each customer's stack, identifies gaps, estimates MRR uplift, and returns ready-to-execute order commands (note: uplift estimates are computed locally from price × quantity, not partner-billed revenue)
- **MRR analytics** — aggregation by company/product/vendor with annual-to-monthly amortization

Every command supports `--json`, so humans and AI agents use the same tool.

## When to use this CLI vs the Pax8 MCP

Pax8 publishes a hosted MCP server at `mcp.pax8.com` for AI assistants — see the [Pax8 MCP docs](https://devx.pax8.com/docs/mcp-server). Use this CLI when you want a richer command surface (recommendations, invoice audit, MRR analytics, demo mode) or when you're scripting against a stable, versioned interface. Use the Pax8 MCP when you want zero-install access via Claude, Cursor, Copilot, or VS Code and you don't need the CLI-specific capabilities.

## Quick Start

```bash
# Install
npm install -g @pax8/cli

# Authenticate
pax8 auth login

# See how your business is doing
pax8 status

# Or try with demo data (no credentials needed)
PAX8_DEMO=1 pax8 status
```

## Demo Flow (90 seconds)

```bash
pax8 status                              # estimated MRR, renewals, growth opportunities
pax8 recommendations list                # Cross-sell and seat gap opportunities
pax8 recommendations act                 # Walk through and place orders (y/s/q)
pax8 companies list                      # Browse customers (type # to drill in)
pax8 companies more "Acme Corp"          # Full customer summary
```

## Commands

### Dashboard

```bash
pax8 status                    # Quick snapshot: estimated MRR, renewals, recs, trials
pax8 status --all              # Full dashboard with top customers and details
pax8 status --renewals         # Focus on upcoming renewals
pax8 status --growth           # Focus on growth opportunities
```

### Companies

```bash
pax8 companies list                            # List all (type # to drill in)
pax8 companies list --status Active            # Filter by status
pax8 companies show "Acme Corp"                # Company details
pax8 companies more "Acme Corp"                # Full summary: subs, vendors, estimated MRR, issues
```

### Subscriptions

```bash
pax8 subscriptions list                                # All subscriptions
pax8 subscriptions list --company "Acme Corp"          # Filter by company
pax8 subscriptions list --status Active                # Filter by status
pax8 subscriptions show <id> --history                 # Details + change history
pax8 subscriptions renewals                            # Upcoming renewals (30d default)
pax8 subscriptions renewals --within 7d                # Urgent renewals
pax8 subscriptions renewals --company "Acme Corp"      # Renewals for one customer
```

### Recommendations

```bash
pax8 recommendations list                              # All growth opportunities
pax8 recommendations list --company "Acme Corp"        # For one customer
pax8 recommendations list --product "AvePoint"         # Filter by product
pax8 recommendations list --priority high              # High priority only
pax8 recommendations act                               # Walk through and order
pax8 recommendations act --company "Acme Corp"         # Act on one customer
pax8 recommendations act --product "backup"            # Add backup everywhere
```

### Orders

```bash
pax8 orders list                                       # Recent orders
pax8 orders create --company "Acme" --product "M365 Business Premium" --quantity 10
pax8 orders show <id>                                  # Check order status
```

The order preview shows unit price, total, and estimated MRR impact before you confirm.

### Cost Simulation

```bash
pax8 cost sim --company "Acme Corp" --product "M365 Business Premium" --quantity 50
pax8 cost sim --company "Acme" --product "M365 Business Premium" --from "M365 Business Basic" --quantity 45
pax8 cost sim --company "Acme" --product "AvePoint Cloud Backup" --quantity 30 --json
```

Model the financial impact of a SKU swap, quantity change, or new-product add before placing the order. The output shows current and proposed monthly/annual cost, the delta, and a per-seat breakdown — pure compute over existing pricing data, no writes.

### Invoices

```bash
pax8 invoices list                                     # All invoices
pax8 invoices list --company "Acme Corp" --status Unpaid
pax8 invoices audit                                    # Flag billing discrepancies
pax8 invoices audit --company "Acme Corp"              # Audit one customer
```

### Products

```bash
pax8 products search "Microsoft 365"                   # Search catalog
pax8 products show <id>                                # Product details + pricing
```

### Diagnostics

```bash
pax8 doctor                    # Node, auth, API endpoints (5/5), cache, telemetry
pax8 auth status               # Check credentials
```

## Output Formats

| Flag | Format | Use case |
|------|--------|----------|
| *(default)* | Colored table | Interactive terminal use |
| `--json` | JSON | Scripting, piping to `jq` |
| `--csv` | CSV | Spreadsheets, PSA imports |
| `--quiet` | Minimal | Cron jobs, CI pipelines |

```bash
pax8 subscriptions list --json | jq '.[] | select(.quantity > 10)'
pax8 invoices list --csv > march-billing.csv
pax8 companies list --ids-only | xargs -I{} pax8 subscriptions list --company {}
```

## REPL Mode

Run `pax8` with no arguments to enter the interactive REPL:

```
$ pax8
pax8> status
pax8> companies list
pax8> 3                          # Drill into company #3
pax8> recommendations act        # Walk through recs
pax8> exit
```

No `pax8` prefix needed. Numbered shortcuts work after list commands.

## Authentication

```bash
# Interactive (stores in ~/.pax8/credentials.json)
# Prompts for Client ID and Client Secret (secret input is masked).
pax8 auth login

# Non-interactive
pax8 auth login --client-id <id> --client-secret <secret>

# Environment variables
export PAX8_CLIENT_ID=your-client-id
export PAX8_CLIENT_SECRET=your-client-secret
```

Generate API credentials in the [Pax8 Integrations Hub](https://app.pax8.com). For detailed setup instructions, see the [Credential Setup Guide](docs/credential-setup.md). A copy-pasteable starter is in [`.env.example`](.env.example).

### Pointing at a non-prod environment

By default, the CLI talks to `https://api.pax8.com/v1`. Partners testing against a sandbox or staging environment can override the base URL without code changes:

```bash
export PAX8_API_BASE=https://staging-api.pax8.com/v1/
pax8 status
pax8 doctor   # confirms the active API base in its output
```

`PAX8_API_BASE` is honored by both the API client and the OAuth token endpoint, so a single override switches the whole CLI (and any process embedding `@pax8/core`) to the alternate environment.

## Demo Mode

Try everything without API credentials:

```bash
PAX8_DEMO=1 pax8 status
PAX8_DEMO=1 pax8 recommendations act
```

Or enable persistently: `pax8 init --demo`

## Claude AI Integration

The CLI ships with a Claude Code skill, so AI agents get the same computed intelligence as human operators — without reimplementing business logic or wrestling with raw API calls.

### What agents get

An agent asking "Am I being overbilled?" doesn't need to make 13+ API calls, join invoice line items against subscriptions, and compute deltas. It runs `pax8 invoices audit --json` and gets categorized discrepancies with dollar impact in one call.

Available tools: companies, subscriptions, renewals, invoices, invoice audits, recommendations, MRR reports, and product search — all returning structured JSON.

### Setup (Claude Code)

The skill wraps CLI commands with behavioral rules (act first, no clarifying questions, parallel fetches when possible). See `packages/claude-skill/skill.md`.

### Example

```
You: "Which customers are missing backup and what's the revenue opportunity?"
Claude: runs pax8 recommendations list --json, returns prioritized gaps
        with estimated MRR uplift and ready-to-execute order commands
```

Works with Claude Code, Cursor, Copilot, and any agent framework that can run shell commands.

## Core library

All business logic lives in [`@pax8/core`](packages/core) with zero CLI dependencies — the renewal tracker, invoice auditor, recommendation engine, and MRR analytics are all importable from a portal feature, a Lambda, a dashboard, or your own tool. The CLI is one consumer; the durable asset is the domain knowledge in `core`. See [`packages/core/README.md`](packages/core/README.md) for the install, import example, and capability list.

## Performance

- **API caching** — repeat calls return in ~80ms (1-hour TTL)
- **Parallel fetching** — dashboard loads companies, subscriptions, and products simultaneously
- **Product name enrichment** — resolves UUIDs to human-readable names automatically

## Development

```bash
git clone https://github.com/pax8labs/pax8-cli.git
cd pax8-cli
pnpm install
pnpm build
pnpm test              # comprehensive test suite (800+ tests across unit, CLI integration, and e2e flows; see CI for current count)
pnpm test:coverage
```

### Architecture

- **`packages/core`** — API client, auth, recommendation engine, types (zero CLI dependencies)
- **`packages/cli`** — Commander.js commands, formatting, interactive UX
- **`packages/claude-skill`** — Claude Code skill

### Telemetry

Anonymous, **opt-in** usage telemetry via PostHog. Off by default — `telemetry.enabled` defaults to `false` in config and the CLI sends nothing until you explicitly opt in.

```bash
pax8 telemetry enable     # Opt in
pax8 telemetry disable    # Opt out
pax8 telemetry status     # Check current state
```

The CLI also honors two ambient environment variables (no opt-in required) and short-circuits before constructing the PostHog client:

- `PAX8_TELEMETRY_DISABLED=1`
- `DO_NOT_TRACK=1` (the [Console Do Not Track](https://consoledonottrack.com) standard)

**Single event:** `command_executed`

| Property | Sent | Notes |
|---|---|---|
| `command` | always | The top-level command, e.g. `companies` |
| `subcommand` | when present | Dotted path, e.g. `recommendations.list` |
| `flags` | always | The flag *names* the user passed (no values) |
| `duration_ms` | always | Wall-clock duration in ms |
| `success` | always | Boolean |
| `error_code` | on error | One of the canonical `ERROR_*` constants — see [`packages/core/src/errors/codes.ts`](packages/core/src/errors/codes.ts) for the full catalog (codes are append-only) |
| `cli_version` | always | From package.json |
| `node_version` | always | `process.version` |
| `os` | always | `process.platform` |
| `demo_mode` | always | Whether `PAX8_DEMO=1` was set |
| `recs_presented`, `recs_ordered`, `recs_skipped`, `recs_mrr_captured` | `recommendations act` | Aggregate counts only |
| `order_success`, `order_total_dollars`, `order_mrr_impact`, `order_seats` | `orders create` | Aggregate transaction outcome only |

The anonymous `distinct_id` is `sha256(hostname + ":" + username)` truncated to 16 hex chars — computed locally, never reversible to its inputs.

**Never sent:**

- API client_id, client_secret, OAuth tokens
- Customer / company / subscription / order IDs
- Customer or company names
- Command argument values (only flag *names* — `--company`, never `--company "Acme Corp"`)
- Partner identifiers, account names, billing data
- Stack traces, file paths, environment variables
- Any PII

**On the embedded PostHog key:** the project key shipped in the bundle is the public, write-only PostHog *project ingestion* key — this is the standard pattern for OSS analytics, and [PostHog's own guidance](https://posthog.com/docs/api#public-posthog-api) recommends embedding it. It cannot read events back, only append.

### Reporting bugs

When a command fails, the CLI prints recovery hints and a one-line nudge:

```
✗ ERROR_AUTH_EXPIRED  Authentication failed.

  Recovery steps:
    → Your credentials may have expired. Run pax8 auth login to re-authenticate.

  → Help us fix this: run pax8 report-bug to file a sanitized report
```

`pax8 report-bug` files a GitHub issue against [`pax8labs/pax8-cli`](https://github.com/pax8labs/pax8-cli) prefilled with the *redacted* envelope of the most recent failure. It runs through a redactor (see [`packages/cli/src/lib/redactor.ts`](packages/cli/src/lib/redactor.ts)) that strips:

- UUIDs (replaced with `<REDACTED:UUID>`)
- Email addresses (`<REDACTED:EMAIL>`)
- `$HOME` paths on macOS / Linux / Windows / `~/...` form (`<REDACTED:PATH>` — the suffix after the username is preserved so the tail of the path is still useful for debugging)
- JWTs and `Bearer` tokens (`<REDACTED:JWT>` / `<REDACTED:TOKEN>`)
- Long opaque hex / base64-shaped strings (`>=32` chars; covers Pax8 client secrets and similar) (`<REDACTED:TOKEN>`)

The reporter is **opt-in per invocation**, not via a config setting. Nothing leaves your machine without explicit `[y/N]` confirmation — the command always prints the body to stdout *first*, so you can see exactly what would be submitted.

```bash
pax8 report-bug             # interactive: review the body, then [y/N]
pax8 report-bug --print     # print the redacted Markdown body and exit
pax8 report-bug --json      # print the redacted envelope as JSON (for piping)
pax8 report-bug -y          # submit without prompting (for scripts)
```

If you have [`gh`](https://cli.github.com) installed and authenticated, the command shells out to `gh issue create`. Otherwise it falls back to opening a prefilled issue URL via your platform's default browser (`open` on macOS, `xdg-open` on Linux, `start` on Windows). No new npm dependencies — only Node's built-in `child_process`.

The error envelope persisted to `~/.pax8/last-error.json` (mode 0600) is what `pax8 report-bug` reads. It contains the same fields as the `--json` error output (`code`, `message`, `causes`, `recoverySteps`, `docsUrl`), plus the command name, flag *names* (no values), CLI / Node / OS versions, and an ISO timestamp. The redactor runs over this envelope on every invocation — so even though the file on disk is your own data, the report you submit cannot leak the content of an argument or a path under your home directory.

### Network egress

For partners on restricted networks, this is the complete allowlist of hosts the CLI may contact:

| Host | When | Required? |
|---|---|---|
| `https://api.pax8.com` | Every API call | Always |
| `https://api.pax8.com/v1/token` | OAuth client-credentials token exchange | Always (during auth) |
| `https://us.i.posthog.com` | Telemetry capture | Only when `pax8 telemetry enable` has been set AND no opt-out env var is present |
| `https://github.com/pax8labs/pax8-cli/issues/new` | Bug-report submission | Only when you run `pax8 report-bug` AND confirm `[y/N]` (or pass `-y`). When `gh` is installed, the upload happens via `gh`; otherwise the URL is opened in your default browser |

No other network egress. The CLI does not contact npm, the Pax8 portal, the marketing site, or any auto-update service at runtime.

### Using @pax8/core as a standalone library

All business logic lives in [`@pax8/core`](packages/core) with zero CLI dependencies — the renewal tracker, invoice auditor, recommendation engine, and MRR analytics are all importable. See [`packages/core/README.md`](packages/core/README.md) for the full API; here is a minimal end-to-end example:

```ts
import {
  Pax8Client,
  TokenManager,
  SubscriptionsApi,
  getUpcomingRenewals,
  ALL_SUBS_PAGE_SIZE,
} from "@pax8/core";

const tokenManager = new TokenManager({
  clientId: process.env.PAX8_CLIENT_ID!,
  clientSecret: process.env.PAX8_CLIENT_SECRET!,
});

const client = new Pax8Client({ tokenManager });
const subscriptions = new SubscriptionsApi(client);

const { content } = await subscriptions.list({ size: ALL_SUBS_PAGE_SIZE });
const report = getUpcomingRenewals(content, 30);

console.log(`${report.items.length} renewals in 30 days, $${report.totalMrrAtRisk}/mo at risk`);
for (const r of report.items.slice(0, 5)) {
  console.log(`  ${r.daysUntilRenewal}d  ${r.companyName}  ${r.productName}  $${r.mrrAtRisk}/mo`);
}
```

The same pattern works for `auditInvoices(...)`, `computeMrr(...)`, `computeGrowth(...)`, and `getRecommendations(...)` — see [`packages/core/README.md`](packages/core/README.md) for the full surface.

## Documentation

- [Credential Setup Guide](docs/credential-setup.md)
- [Product Requirements](docs/PRD.md)
- [Credential Setup Guide](docs/credential-setup.md)
- [Build Prompt](docs/BUILD.md)
- [Pax8 API Reference](https://devx.pax8.com/)

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0 — see [LICENSE](LICENSE)

---

Pax8 and the Pax8 logo are trademarks of Pax8, Inc.
