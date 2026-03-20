# pax8-cli

An open-source, cross-platform CLI for managing Pax8 cloud marketplace operations. Built for MSPs who want to manage subscriptions, billing, and customers from the terminal instead of clicking through a web portal.

## Features

- **Full Pax8 API coverage** — companies, subscriptions, orders, invoices, products, contacts, quotes, webhooks
- **Smart defaults** — auto-detects output format (table for TTY, JSON for pipes), infers context, sensible date ranges
- **Renewal intelligence** — track NCE subscription renewals, get alerts before lock-in
- **Billing audit** — automatically flag invoice discrepancies against active subscriptions
- **Scriptable** — `--json`, `--csv`, meaningful exit codes, designed for shell pipelines
- **Actionable errors** — every error tells you what went wrong, why, and what to do next
- **Claude AI skill** — natural language queries over your Pax8 data via Claude Code

## Quick Start

```bash
# Install
npm install -g @pax8/cli

# Authenticate (you'll need Pax8 API credentials from the Integrations Hub)
pax8 auth login

# List your customers
pax8 companies list

# Check upcoming renewals
pax8 subscriptions renewals --within 14d

# Audit this month's billing
pax8 invoices audit
```

## Usage

```bash
# Companies
pax8 companies list
pax8 companies show "Acme Corp" --subscriptions

# Subscriptions
pax8 subscriptions list --company "Acme Corp"
pax8 subscriptions update <id> --quantity 50
pax8 subscriptions renewals --within 30d

# Invoices
pax8 invoices list --month 2026-03
pax8 invoices audit --month 2026-03

# Products
pax8 products search "Microsoft 365 Business Premium" --pricing

# Orders
pax8 orders create --company "Acme Corp" --product "M365 Business Premium" --quantity 10

# Reports
pax8 report mrr --by company
pax8 report renewals --within 90d

# Pipe-friendly
pax8 subscriptions list --json | jq '.[] | select(.quantity > 10)'
pax8 invoices items --month 2026-03 --csv > march-billing.csv
```

## Authentication

The CLI uses OAuth 2.0 client credentials. Generate your API credentials in the [Pax8 Integrations Hub](https://app.pax8.com).

```bash
# Interactive login (prompts for credentials, stores in OS keychain)
pax8 auth login

# Non-interactive (for CI/scripts)
pax8 auth login --client-id <id> --client-secret <secret>

# Or via environment variables (macOS / Linux)
export PAX8_CLIENT_ID=your-client-id
export PAX8_CLIENT_SECRET=your-client-secret

# PowerShell
$env:PAX8_CLIENT_ID="your-client-id"
$env:PAX8_CLIENT_SECRET="your-client-secret"
```

## Configuration

```bash
# Interactive setup
pax8 config init

# Config file location
pax8 config path
# ~/.pax8/config.yaml

# Diagnose issues
pax8 doctor
```

## Claude AI Skill

The CLI includes a Claude Code skill for natural-language Pax8 operations:

```
> "Which customers have Microsoft 365 subscriptions renewing this month?"
> "Anything unusual in last month's billing?"
> "What would it cost to add 10 seats of E3 for Contoso?"
```

Install the skill in Claude Code to enable AI-assisted MSP workflows.

## Output Formats

| Flag | Format | Use case |
|------|--------|----------|
| *(default)* | Colored table | Interactive terminal use |
| `--json` | JSON | Scripting, piping to `jq` |
| `--csv` | CSV | Spreadsheets, PSA imports |
| `--quiet` | Minimal | Cron jobs, CI pipelines |

## Demo Mode

Try the CLI without API credentials using demo mode with realistic mock data:

```bash
# macOS / Linux
PAX8_DEMO=1 pax8 companies list
PAX8_DEMO=1 pax8 subscriptions renewals --within 14d
PAX8_DEMO=1 pax8 invoices audit

# PowerShell
$env:PAX8_DEMO="1"; pax8 companies list
$env:PAX8_DEMO="1"; pax8 subscriptions renewals --within 14d
$env:PAX8_DEMO="1"; pax8 invoices audit
```

## Development

```bash
# Clone and install
git clone https://github.com/your-org/pax8-cli.git
cd pax8-cli
pnpm install

# Build all packages
pnpm build

# Run tests (435 tests)
pnpm test

# Run with coverage
pnpm test:coverage

# Run CLI in dev mode
# macOS / Linux
PAX8_DEMO=1 pnpm dev -- companies list

# PowerShell
$env:PAX8_DEMO="1"; pnpm dev -- companies list
```

### Architecture

- **`packages/core`** — API client, auth, services, types (zero CLI dependencies)
- **`packages/cli`** — Commander.js commands, formatting, UX
- **`packages/claude-skill`** — Claude Code skill wrapping CLI as AI tools

## Documentation

- [Product Requirements Document](docs/PRD.md)
- [Pax8 API Reference](https://devx.pax8.com/)
- [Build Prompt](docs/BUILD.md) — autonomous build instructions

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
