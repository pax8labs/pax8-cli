# pax8-cli

An open-source CLI for managing Pax8 cloud marketplace operations. Built for MSPs who want to manage subscriptions, billing, customers, and growth opportunities from the terminal.

## Highlights

- **Business dashboard** — `pax8 status` shows MRR, renewals, growth opportunities, and expiring trials in one command
- **Recommendation engine** — analyzes customer portfolios, flags missing products (backup, security, identity), and estimates MRR uplift
- **Act on recommendations** — `pax8 recommendations act` walks through opportunities one by one and places orders
- **Full Pax8 API coverage** — companies, subscriptions, orders, invoices, products
- **Claude AI integration** — agents get structured access to renewals, audits, recommendations, and MRR via MCP server
- **Smart UX** — interactive drill-downs, copy-paste order commands, actionable error messages

## Why This Exists

The Pax8 API is a CRUD layer — it returns raw subscriptions, invoices, and products. It doesn't answer the questions MSPs actually ask: *Which renewals are coming up? Am I being overbilled? Which customers are missing backup?*

This CLI computes what the API doesn't:

- **Renewal tracking** — no renewals endpoint exists; the CLI parses commitment dates, calculates MRR at risk, and sorts by urgency
- **Invoice auditing** — cross-references invoice line items against active subscriptions to flag overcharges and undercharges with dollar impact
- **Upsell recommendations** — analyzes each customer's stack, identifies gaps, estimates MRR uplift, and returns ready-to-execute order commands
- **MRR analytics** — aggregation by company/product/vendor with annual-to-monthly amortization

Every command supports `--json`, so humans and AI agents use the same tool.

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
pax8 companies list                      # Browse customers (type # to drill in)
pax8 companies more "Acme Corp"          # Full customer summary
pax8 recommendations list                # Cross-sell and seat gap opportunities
pax8 recommendations act                 # Walk through and place orders (y/s/q)
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
pax8 doctor                    # Node, auth, API endpoints (5/5), cache, MCP, telemetry
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

Generate API credentials in the [Pax8 Integrations Hub](https://app.pax8.com). For detailed setup instructions, see the [Credential Setup Guide](docs/credential-setup.md).

## Demo Mode

Try everything without API credentials:

```bash
PAX8_DEMO=1 pax8 status
PAX8_DEMO=1 pax8 recommendations act
```

Or enable persistently: `pax8 init --demo`

## Claude AI Integration

The CLI includes an MCP server and a Claude Code skill, so AI agents get the same computed intelligence as human operators — without reimplementing business logic or wrestling with raw API calls.

### What agents get

An agent asking "Am I being overbilled?" doesn't need to make 13+ API calls, join invoice line items against subscriptions, and compute deltas. It runs `pax8 invoices audit --json` and gets categorized discrepancies with dollar impact in one call.

Available tools: companies, subscriptions, renewals, invoices, invoice audits, recommendations, MRR reports, and product search — all returning structured JSON.

### Setup (Claude Code)

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "pax8": {
      "command": "pax8",
      "args": ["mcp"]
    }
  }
}
```

Or use the Claude Code skill directly — it wraps CLI commands with behavioral rules (act first, no clarifying questions, parallel fetches when possible).

### Example

```
You: "Which customers are missing backup and what's the revenue opportunity?"
Claude: runs pax8 recommendations list --json, returns prioritized gaps
        with estimated MRR uplift and ready-to-execute order commands
```

Works with Claude Code, Cursor, Copilot, and any agent framework that can run shell commands.

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
pnpm test              # 700+ tests (739 and counting)
pnpm test:coverage
```

### Architecture

- **`packages/core`** — API client, auth, recommendation engine, types (zero CLI dependencies)
- **`packages/cli`** — Commander.js commands, formatting, interactive UX
- **`packages/claude-skill`** — Claude Code MCP skill

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
