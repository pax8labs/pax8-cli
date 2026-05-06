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

- **Renewal tracking** — no renewals endpoint exists; the CLI parses commitment dates, calculates MRR at risk, and sorts by urgency
- **Invoice auditing** — cross-references invoice line items against active subscriptions to flag overcharges and undercharges with dollar impact
- **Upsell recommendations** — analyzes each customer's stack, identifies gaps, estimates MRR uplift, and returns ready-to-execute order commands
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
pax8 status                              # MRR, renewals, growth opportunities
pax8 recommendations list                # Cross-sell and seat gap opportunities
pax8 recommendations act                 # Walk through and place orders (y/s/q)
pax8 companies list                      # Browse customers (type # to drill in)
pax8 companies more "Acme Corp"          # Full customer summary
```

## Commands

### Dashboard

```bash
pax8 status                    # Quick snapshot: MRR, renewals, recs, trials
pax8 status --all              # Full dashboard with top customers and details
pax8 status --renewals         # Focus on upcoming renewals
pax8 status --growth           # Focus on growth opportunities
```

### Companies

```bash
pax8 companies list                            # List all (type # to drill in)
pax8 companies list --status Active            # Filter by status
pax8 companies show "Acme Corp"                # Company details
pax8 companies more "Acme Corp"                # Full summary: subs, vendors, MRR, issues
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

The order preview shows unit price, total, and MRR impact before you confirm.

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
pnpm test              # full test suite (~840 tests)
pnpm test:coverage
```

### Architecture

- **`packages/core`** — API client, auth, recommendation engine, types (zero CLI dependencies)
- **`packages/cli`** — Commander.js commands, formatting, interactive UX
- **`packages/claude-skill`** — Claude Code skill

### Telemetry

Anonymous, opt-in usage telemetry via PostHog. Tracks command names, duration, and revenue processed — never credentials, company data, or PII.

```bash
pax8 telemetry enable    # Opt in
pax8 telemetry disable   # Opt out
```

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
