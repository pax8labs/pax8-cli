# pax8-cli

An open-source CLI for managing Pax8 cloud marketplace operations. Built for MSPs who want to manage subscriptions, billing, customers, and growth opportunities from the terminal.

## Status

Published on npm as `@pax8/cli`. We're using engagement signals (installs, issues, command usage) to learn which capabilities are worth investing in further. Feedback, issues, and PRs are welcome.

## Highlights

- **Answers the API doesn't** — renewals, invoice audit, upsell recommendations, Pax8 cost analytics computed locally from raw Pax8 data
- **Closes the loop** — `pax8 recommendations act` walks portfolio gaps and places the orders, so insight and action live in the same tool
- **Works for humans and agents identically** — every command emits structured JSON, so a Claude Code skill, a shell pipeline, or a person at a terminal all use the same surface
- **Demo mode** — `PAX8_DEMO=1` runs every command against an in-memory fixture, no credentials required

## Why This Exists

The Pax8 API is a CRUD layer — it returns raw subscriptions, invoices, and products. It doesn't answer the questions MSPs actually ask: *Which renewals are coming up? Am I being overbilled? Which customers are missing backup?*

This CLI computes what the API doesn't:

- **Renewal tracking** — no renewals endpoint exists; the CLI parses commitment dates, calculates the Pax8 monthly cost renewing in window (a temporal filter, not a churn-risk prediction — see Metric definitions), and sorts by urgency
- **Invoice auditing** — cross-references invoice line items against active subscriptions to flag overcharges and undercharges with dollar impact
- **Upsell recommendations** — analyzes each customer's stack, identifies gaps, estimates the additional Pax8 monthly cost if acted on, and returns ready-to-execute order commands (note: estimates are computed locally from price × quantity — the partner's cost-to-Pax8, not partner-side resale revenue)
- **Pax8 cost analytics** — aggregation by company/product/vendor with annual-to-monthly amortization. Reports the partner's monthly / annualized cost to Pax8, not partner-side resale revenue

Every command supports `--json`, so humans and AI agents use the same tool.

## When to use this CLI vs the Pax8 MCP

Pax8 publishes a hosted MCP server at `mcp.pax8.com` for AI assistants — see the [Pax8 MCP docs](https://devx.pax8.com/docs/mcp-server). Use this CLI when you want a richer command surface (recommendations, invoice audit, Pax8 cost analytics, demo mode) or when you're scripting against a stable, versioned interface. Use the Pax8 MCP when you want zero-install access via Claude, Cursor, Copilot, or VS Code and you don't need the CLI-specific capabilities.

## Prerequisites: Node.js

Run `node --version` in your terminal.

- If it prints **v20** or newer, you're set — skip to [Quick Start](#quick-start).
- If it prints an older version, or you see `command not found`, install Node.js. Use the GUI installer by default; the package-manager one-liners below are just shortcuts if you already use one.
  - **For any OS:** download the Node.js LTS installer from [nodejs.org](https://nodejs.org) and run it.
  - **Windows, if you already use winget** (built into Windows 10/11): `winget install OpenJS.NodeJS.LTS`.
  - **Windows, if you already use Chocolatey:** `choco install nodejs-lts`.
  - **macOS or Linux, if you already use Homebrew:** `brew install node` (installs current Node).

Once installed — whichever path you took — close this terminal, open a new one, and run `node --version` again. All of these paths leave your existing shell with a stale `PATH`; a fresh shell is what picks up the new `node` binary.

## Quick Start

Don't have Node 20+? See [Prerequisites](#prerequisites-nodejs) first.

### Try with demo data (no credentials)

```bash
PAX8_DEMO=1 npx -y -p @pax8/cli pax8 dashboard
```

### Use with live Pax8 API

```bash
npx -y -p @pax8/cli pax8 auth login
npx -y -p @pax8/cli pax8 dashboard
```

### Install permanently (optional)

```bash
npm install -g @pax8/cli
pax8 dashboard
```

> **Permission denied?** If `npm install -g` fails with `EACCES` (permission denied), do not use `sudo`. Either use `npx` instead, or install Node via a version manager (nvm or fnm) so the global prefix lives in your home directory. See [Troubleshooting](#troubleshooting) for details.

## Demo Flow (90 seconds)

Run with demo data by prefixing `PAX8_DEMO=1`:

```bash
PAX8_DEMO=1 pax8 dashboard               # Pax8 monthly cost, renewals, growth opportunities
PAX8_DEMO=1 pax8 recommendations list    # Cross-sell and seat gap opportunities
PAX8_DEMO=1 pax8 recommendations act     # Walk through and place orders (y/s/q)
PAX8_DEMO=1 pax8 clients list            # Browse customers (type # to drill in)
PAX8_DEMO=1 pax8 clients show "Acme"    # Full customer summary
```

Or if you installed globally:

```bash
pax8 init --demo                         # Enable demo mode persistently
pax8 dashboard
pax8 recommendations list
pax8 recommendations act
```

## Commands

`pax8 --help` is the canonical inventory; every command and subcommand documents its flags via `pax8 <command> --help`. The sections below cover the most-used surface; the [More commands](#more-commands) section near the end lists the rest.

### Dashboard

```bash
pax8 dashboard                 # Quick snapshot: Pax8 monthly cost, renewals, recs, trials
pax8 dashboard --all           # Full dashboard with top customers and details
pax8 dashboard --renewals      # Focus on upcoming renewals
pax8 dashboard --growth        # Focus on growth opportunities
```

### Clients

```bash
pax8 clients list                              # List all (type # to drill in)
pax8 clients list --status Active              # Filter by status
pax8 clients show "Acme Corp"                  # Customer details
pax8 clients more "Acme Corp"                  # Full summary: subs, vendors, Pax8 monthly cost, issues
pax8 clients create --name "Acme" --city Denver --state CO --zip 80202 --phone "+1-303-555-0101" --first-name Maya --last-name Chen --email maya@acme.example.com --yes
```

> **Note:** The single contact you supply on `clients create` is set as primary on all three types (Admin, Billing, Technical). Split roles afterward via `pax8 contacts update` or additional `pax8 contacts create --type` calls.

> `pax8 clients *` is the canonical (and only) command surface. The earlier `pax8 companies *` alias was removed pre-launch (#476); update any scripts that called the old verb. The data surface (`companyId`, `companyName`, `--company` flag, etc.) stays aligned with the wire until Pax8's API renames the field.

### Subscriptions

```bash
pax8 subscriptions list                                # All subscriptions
pax8 subscriptions list --company "Acme Corp"          # Filter by company
pax8 subscriptions list --status Active                # Filter by status
pax8 subscriptions show <id> --history                 # Details + change history
pax8 subscriptions renewals                            # Upcoming renewals (30d default)
pax8 subscriptions renewals --within 7d                # Urgent renewals
pax8 subscriptions renewals --company "Acme Corp"      # Renewals for one company
```

### Recommendations

```bash
pax8 recommendations list                              # All growth opportunities
pax8 recommendations list --company "Acme Corp"        # For one company
pax8 recommendations list --product "AvePoint"         # Filter by product
pax8 recommendations list --priority high              # High priority only
pax8 recommendations act                               # Walk through and order
pax8 recommendations act --company "Acme Corp"         # Act on one company
pax8 recommendations act --product "backup"            # Add backup everywhere
pax8 recommendations act --yes                         # Non-interactive: place all matches
```

### Orders

```bash
pax8 orders list                                       # Recent orders
pax8 orders create --company "Acme" --product "M365 Business Premium" --quantity 10
pax8 orders show <id>                                  # Check order status
```

The order preview shows unit price, total, and estimated Pax8 monthly cost impact before you confirm.

### Cost Simulation

```bash
pax8 cost sim --company "Acme Corp" --product "Microsoft 365 Business Premium" --quantity 50
pax8 cost sim --company "Acme Corp" --product "Microsoft 365 Business Premium" --from "Microsoft 365 Business Basic" --quantity 45
pax8 cost sim --company "Acme Corp" --product "AvePoint Cloud Backup for Microsoft 365" --quantity 30 --billing-term Monthly --json
```

Model the financial impact of a SKU swap, quantity change, or new-product add before placing the order. The output shows current and proposed monthly/annual cost, the delta, and a per-seat breakdown — pure compute over existing pricing data, no writes.

### Invoices

```bash
pax8 invoices list                                     # All invoices
pax8 invoices list --company "Acme Corp" --status Unpaid
pax8 invoices audit                                    # Flag billing discrepancies
pax8 invoices audit --company "Acme Corp"              # Audit one company
```

### Products

```bash
pax8 products search "Microsoft 365"                   # Search catalog
pax8 products show <id>                                # Product details + pricing
```

### Reports

Pax8-cost reporting surface — what's renewing, where your spend is concentrated, and grouped subscription rollups.

```bash
pax8 report renewals --within 90                       # Subscriptions ending in the next 90 days
pax8 report concentration --by client --top 5          # Top customers by Pax8 cost
pax8 report concentration --by vendor --json           # Concentration by vendor
pax8 report subscriptions --by billing-term            # Active subs grouped by billing term
pax8 report subscriptions --by vendor --json           # Pax8 cost rollup by vendor
```

All values are Pax8 cost (what Pax8 charges you), emitted as `{ amount, currency }` envelopes. For partner-side resale revenue, combine with sell-through pricing from your PSA.

### Diagnostics

```bash
pax8 doctor                    # Node, auth, API endpoints, cache, telemetry
pax8 auth status               # Check credentials
pax8 version                   # CLI version
```

### More commands

The full surface also includes these less-prominent command groups — see `pax8 <group> --help` for flags and examples:

```bash
pax8 contacts list|show|create|update|delete           # Per-company contacts (Admin/Billing/Technical)
pax8 quotes list|show|create|update|send|delete        # Sales quotes (v2 API)
pax8 webhooks list|create|update|delete|enable|disable # Subscription endpoints
pax8 webhooks logs|test|topics                         # Delivery history, fire test deliveries, list topics
pax8 usage list|show                                   # Metered usage (Azure consumption, etc.)
pax8 config init|show|set|path                         # Config file management
pax8 init                                              # First-run setup wizard
pax8 completions bash                                  # Shell completions (bash/zsh/fish/powershell)
pax8 report-bug                                        # File a sanitized GitHub issue from the last failure (see Reporting bugs)
pax8 telemetry enable|disable|status                   # Opt-in usage telemetry (see Telemetry)
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
pax8 clients list --ids-only | xargs -I{} pax8 subscriptions list --company {}
```

**Piping JSON to other tools.** Banners and spinners go to stderr; redirect for clean JSON:

```bash
pax8 subscriptions list --json 2>/dev/null | jq '.[].id'
pax8 dashboard --json 2>/dev/null > today.json
```

## REPL Mode

Run the CLI with no arguments to enter the interactive REPL — works with any of the three invocation paths from [Quick Start](#2-run-it):

```bash
pax8                                    # if linked via npm link
node packages/cli/dist/index.js         # from a built checkout
pnpm dev                                # dev mode (tsx)
```

You'll see the Pax8 ASCII banner with a tagline, your CLI version, and a "Common commands" cheat sheet — then a `pax8>` prompt:

```
$ pax8

  ────────────────────────────────────────────────

      ██████╗  █████╗ ██╗  ██╗ █████╗
      ██╔══██╗██╔══██╗╚██╗██╔╝██╔══██╗
      ██████╔╝███████║ ╚███╔╝ ╚█████╔╝
      ██╔═══╝ ██╔══██║ ██╔██╗ ██╔══██╗
      ██║     ██║  ██║██╔╝ ██╗╚█████╔╝
      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝ ╚════╝

      C O M M A N D   L I N E

  Common commands:
    dashboard               Portfolio at a glance
    subscriptions renewals  What's renewing in 30 days
    recommendations         Upsell opportunities
    invoices audit          Reconcile invoices vs subscriptions

  Type a command, or help / exit

pax8> dashboard
pax8> clients list
pax8> 3                          # Drill into client #3
pax8> back                       # Re-run the last list command
pax8> n                          # Next page; p for previous
pax8> recommendations act        # Walk through recs
pax8> exit
```

No `pax8` prefix needed inside the REPL. Numbered shortcuts work after any list command (pick the row by position). The cheat-sheet adapts to your auth state: if you're not yet authenticated, you'll see `init --demo` / `auth login` / `doctor` instead of the common-commands list.

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

Pass `--browser` to `pax8 auth login` to open the [credentials page](https://app.pax8.com/integrations/credentials) in your default browser before the prompt — you still paste the Client ID and Secret into the terminal (the flag doesn't eliminate the secret, just the click-through to find the page). Falls back to printing the URL on headless / SSH boxes.

### Pointing at a non-prod environment

By default, the CLI talks to `https://api.pax8.com/v1`. Partners testing against a sandbox or staging environment can override the base URL without code changes:

```bash
export PAX8_API_BASE=https://staging-api.pax8.com/v1/
pax8 dashboard
pax8 doctor   # confirms the active API base in its output
```

`PAX8_API_BASE` is honored by both the API client and the OAuth token endpoint, so a single override switches the whole CLI (and any process embedding `@pax8/core`) to the alternate environment.

## Demo Mode

Run any command against sample data without API credentials by prefixing with `PAX8_DEMO=1`:

```bash
PAX8_DEMO=1 pax8 dashboard
PAX8_DEMO=1 pax8 recommendations act
```

Alternatively, enable demo mode persistently in your config:

```bash
pax8 init --demo
pax8 dashboard              # Now runs with sample data by default
```

Disable demo mode with `pax8 init --demo off`.

## Claude AI Integration

The CLI ships with a Claude Code skill, so AI agents get the same computed intelligence as human operators — without reimplementing business logic or wrestling with raw API calls.

### What agents get

An agent asking "Am I being overbilled?" doesn't need to make 13+ API calls, join invoice line items against subscriptions, and compute deltas. It runs `pax8 invoices audit --json` and gets categorized discrepancies with dollar impact in one call.

Available tools: clients, subscriptions, renewals, invoices, invoice audits, recommendations, Pax8 cost rollups, and product search — all returning structured JSON.

### Setup (Claude Code)

The skill wraps CLI commands with behavioral rules (act first, no clarifying questions, parallel fetches when possible). See `packages/claude-skill/skill.md`.

### Example

```
You: "Which customers are missing backup, and how much would adding it cost?"
Claude: runs pax8 recommendations list --json, returns prioritized gaps
        with the estimated additional Pax8 monthly cost per gap and
        ready-to-execute order commands
```

Works with Claude Code, Cursor, Copilot, and any agent framework that can run shell commands.

For non-Claude agent runtimes, see [`AGENTS.md`](AGENTS.md) at the repo root.

## Core library

All business logic lives in [`@pax8/core`](packages/core) with zero CLI dependencies — the renewal tracker, invoice auditor, recommendation engine, and Pax8 cost analytics are all importable from a portal feature, a Lambda, a dashboard, or your own tool. The CLI is one consumer; the durable asset is the domain knowledge in `core`. See [`packages/core/README.md`](packages/core/README.md) for the install, import example, and capability list.

## Performance

- **API caching** — repeat calls return in ~80ms (1-hour TTL)
- **Parallel fetching** — dashboard loads clients, subscriptions, and products simultaneously
- **Product name enrichment** — resolves UUIDs to human-readable names automatically

## Troubleshooting

### `command not found: pax8` or `npx: command not found`

**Cause:** Node.js is not installed on your system.

**Solution:** Install [Node.js 20+](https://nodejs.org/) from nodejs.org.

### `command not found: pax8` after installing Node.js

**Cause:** Your terminal session started before Node.js was installed, so its `PATH` doesn't yet include npm's binary directory.

**Solution:** Close the terminal and open a new one, then re-run the command. Most shells only read `PATH` at startup, so a freshly opened terminal will pick up the new installation. To reload in place without opening a new window, run `exec $SHELL`.

**Still not found in a new shell?** Run `node --version`. If it prints `v20.x` or newer but `pax8` or `npx` still aren't found, this is a real `PATH` problem rather than a stale shell — your Node install put its binaries somewhere that isn't on `PATH` (common with version managers that need extra shell config). If `node --version` also fails, the install didn't complete; reinstall from [nodejs.org](https://nodejs.org/).

### `npm ERR! code EACCES` during `npm install -g`

**Cause:** npm doesn't have permission to write to the global installation directory (usually because it's owned by root).

**Solution:** Do not use `sudo`. Instead:

- Use `npx` to run without a global install: `npx -y -p @pax8/cli pax8 <command>`
- Or install Node via a version manager:
  - [nvm](https://github.com/nvm-sh/nvm) (Node Version Manager for macOS/Linux)
  - [fnm](https://github.com/Schniz/fnm) (Fast Node Manager, works on Windows/macOS/Linux)
- Or set an npm prefix in your home directory: `npm config set prefix ~/.npm && export PATH=~/.npm/bin:$PATH`

### Issues getting started?

Run the diagnostic command to check your setup:

```bash
pax8 doctor
```

This verifies Node.js version, authentication, API connectivity, cache, and telemetry. If all checks pass, try running a command like `pax8 dashboard` to confirm end-to-end functionality.

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
| `command` | always | The top-level command, e.g. `clients` |
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
- **Positional argument values** (the client / customer / product names you typed at the command line) — replaced with `<REDACTED:ARG>` placeholders in both the `command` field and the `Message` body. The command structure (`clients show <REDACTED:ARG>`) is preserved so maintainers can reproduce the bug without partner-specific data ever leaving your machine.

The reporter is **opt-in per invocation**, not via a config setting. Nothing leaves your machine without explicit `[y/N]` confirmation — the command always prints the body to stdout *first*, so you can see exactly what would be submitted.

**Maintainer-side drift watcher:** Pax8 also runs an internal scheduled GitHub Action (`.github/workflows/api-watch.yml`) that queries the same PostHog telemetry stream every 6 hours and opens a maintainer issue when `ERROR_API_VALIDATION` events spike above a threshold. This is a purely aggregate, server-side view used for maintainer triage — it reads only the anonymised event counts and CLI version strings already in PostHog. Partners' data is unchanged; no new data collection is involved.

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

All business logic lives in [`@pax8/core`](packages/core) with zero CLI dependencies — the renewal tracker, invoice auditor, recommendation engine, and Pax8 cost analytics (`computeMrr`, `computeGrowth`) are all importable. See [`packages/core/README.md`](packages/core/README.md) for the full API; here is a minimal end-to-end example:

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

console.log(`${report.items.length} renewals in 30 days, $${report.totalMrrRenewing}/mo renewing`);
for (const r of report.items.slice(0, 5)) {
  console.log(`  ${r.daysUntilRenewal}d  ${r.companyName}  ${r.productName}  $${r.mrrRenewing}/mo`);
}
```

The same pattern works for `auditInvoices(...)`, `computeMrr(...)`, `computeGrowth(...)`, and `getRecommendations(...)` — see [`packages/core/README.md`](packages/core/README.md) for the full surface. `computeMrr` / `computeGrowth` are retained in `@pax8/core` for embeddable reuse; the CLI-side reporting surface is now `pax8 report renewals|concentration|subscriptions` (Pax8-cost framed, emits `AmountCurrency` envelopes). The previous `pax8 report mrr` / `pax8 report growth` CLI commands were removed because they framed Pax8-cost data as partner-side MRR.

## Known Limitations

These are tracked, prioritized for v0.1.x, and not blockers for v0.1.0. Each links to a GitHub issue with repro and fix shape.

**Real-API surfaces (depend on Pax8 backend):**
- `pax8 orders list` against busy tenants can hit the 30s default timeout. Extend it by setting `PAX8_TIMEOUT_MS=<ms>` (default 30000, max 300000). Workaround for very large portfolios: `--size 25` or smaller.
- `pax8 usage list` returns 404 against the live Pax8 sandbox tenant — likely a path-version mismatch in the client; demo mode works ([#212](https://github.com/pax8labs/pax8-cli/issues/212)).
- `pax8 doctor` marks the `~/.pax8/config` file as ✗ (and exits 1) when credentials are configured purely via env vars or `PAX8_DEMO=1` ([#220](https://github.com/pax8labs/pax8-cli/issues/220)).

**Demo-mode UX:**
- Some demo fixtures are thin (`usage`, `quotes`, `webhooks`) — README quick-start commands work but produce minimal output ([#196](https://github.com/pax8labs/pax8-cli/issues/196)).
- List commands with 0 rows render an empty table rather than a helpful empty-state message ([#197](https://github.com/pax8labs/pax8-cli/issues/197)).

**Human-render UX invariants (tooling gap):**
- The per-command e2e matrix exercises every command in subprocess (non-TTY) mode, where the CLI's agent-first contract auto-routes to JSON. Some UX invariants (no UUIDs leaking into table cells, density bounds on tables, drill-in hint visibility) only apply in TTY-render mode and need a node-pty harness — tracked as a follow-up to broaden matrix coverage.

**Polish:**
- No update-notifier — the CLI doesn't tell you when a newer version exists ([#183](https://github.com/pax8labs/pax8-cli/issues/183)).
- The scheduled API-drift watcher only filters `ERROR_API_VALIDATION` events; widening to `ERROR_API_TIMEOUT` / `ERROR_API_NOT_FOUND` / etc. is tracked separately ([#213](https://github.com/pax8labs/pax8-cli/issues/213)). Also note: the watcher is silent until `POSTHOG_PROJECT_API_KEY` is provisioned in repo secrets, and telemetry is opt-in by default.

## Metric definitions

The CLI surfaces partner-side Pax8 cost figures across `pax8 dashboard`, `pax8 clients more`, and `pax8 subscriptions renewals`. These reflect the partner's monthly / annualized cost to Pax8 (sum of price × quantity across active subs, amortized monthly) — not partner-side resale revenue or partner-billed MRR. Internal Pax8 reporting may also call this "Partner Gross MRR" in the Unified Semantic Layer; the CLI's user-facing labels frame it as cost to disambiguate.

Pax8 monthly cost: The partner's monthly cost to Pax8 from active
subscriptions. For monthly billing terms: price × quantity. For annual
billing terms: (price × quantity) ÷ 12. For 2-Year: ÷ 24. For 3-Year: ÷ 36.
Excludes one-time charges and prorated amounts. Emitted on `dashboard --json`,
`clients more --json`, and the `report subscriptions / renewals / concentration`
commands as a wrapped `AmountCurrency` object: `{ "amount": number,
"currency": string }`. The wrapped shape matches the canonical Pax8 wire
envelope (`AmountCurrency` from `@pax8/core`).

Pax8 annual cost: Pax8 monthly cost × 12. The yearly equivalent. Emitted
as `annualCost` with the same `{ amount, currency }` shape.

### Renewal exposure vs. churn risk (`mrrRenewing`)

`pax8 subscriptions renewals` emits `mrrRenewing` (and `arrRenewing`) on each
row and a `totalMrrRenewing` / `totalArrRenewing` aggregate. The field names
are preserved on the wire so existing partner-side risk-framing scripts keep
working; the values are the partner's Pax8 monthly / annual cost from
subscriptions whose commitment ends within the requested window. These are
**temporal filters**, not churn-risk predictions. Pax8's patent-filed
Revenue at Risk Predictor is a separate ML-based product that scores the
probability of churn; the CLI does not expose that signal.

The previous field names (`mrrAtRisk`, `arrAtRisk`, `totalMrrAtRisk`,
`totalArrAtRisk`) silently conflated with that ML model's name. They are
retained as deprecated aliases — emitted alongside the new keys with the same
value — for one minor version cycle so existing scripts don't break, then
removed.

### Cross-product coverage gaps vs. Seat Utilization

`pax8 recommendations list` surfaces **cross-product seat mismatches** (e.g.
100 email seats but only 30 backup seats — flagged as `seat_gap`). This is
distinct from Pax8's canonical "Seat Utilization" metric, which measures
single-product assigned-vs-purchased seats. The CLI's heuristic is a coverage
signal across the customer's stack, not a utilization rate within one product.

### Recommendations taxonomy vs. STAX

`pax8 recommendations list` emits a `type` field with the CLI's local product
taxonomy alongside an `opportunityType` field with OE's canonical 5-type
taxonomy. Two things diverge from Pax8's canonical models — partners parsing
`--json` should know about both:

1. **Product categories.** The recommendations engine bins products into a
   local 7-category taxonomy (`productivity`, `email`, `security`,
   `endpoint_protection`, `identity`, `backup`, `cloud_infrastructure`) that
   does **not** match Pax8's canonical STAX taxonomy (8 L1 categories:
   Productivity, Infrastructure, Continuity, Security, Communications,
   Network, Operations, Network & Communications Commissioned). The CLI
   over-decomposes Security into four buckets and omits Communications,
   Network, and Operations entirely. The simplification was deliberate for
   the local security-focused cross-sell heuristic.

2. **`seat_gap` heuristic.** The CLI's `seat_gap` type flags **cross-product**
   seat mismatches (e.g. 100 email seats but only 30 backup seats). It is
   **not** Pax8's canonical Seat Utilization metric, which is a
   single-product assigned-vs-purchased rate. The closest OE-canonical
   surrogate is `Upsell` — carried on the additive `opportunityType` field.

| CLI category (`type` / module taxonomy) | Closest Pax8 / OE concept | Notes |
| --- | --- | --- |
| `productivity` | STAX L1 *Productivity* | Aligned |
| `email`, `security`, `endpoint_protection`, `identity` | STAX L1 *Security* (+ *Productivity* for email) | CLI over-decomposes STAX *Security* into four buckets |
| `backup` | STAX L1 *Continuity* | Aligned |
| `cloud_infrastructure` | STAX L1 *Infrastructure* | Aligned |
| (no CLI category) | STAX L1 *Communications* / *Network* / *Operations* | Not currently produced by the engine |
| `type: "seat_gap"` | OE `opportunityType: "Upsell"` (closest), NOT Seat Utilization | Cross-product coverage signal, not a utilization rate |
| `type: "cross_sell"` + active subs | OE `opportunityType: "Cross-sell"` | Both carried on the record |
| `type: "cross_sell"` + zero-sub company | OE `opportunityType: "Net-new"` | Both carried on the record |

Both the CLI's product taxonomy and the `seat_gap` heuristic will sunset when
Pax8's first-party Opportunity Explorer API ships (`GET /opportunities`).
The local taxonomy is replaced at that point — tracked under
[#375](https://github.com/pax8labs/pax8-cli/issues/375). The module docstring
at `packages/core/src/services/recommendations.ts` carries the same disclosure
for in-IDE readers; this README section is the canonical version for partners
who only see `--json` output.

## Documentation

- [Credential Setup Guide](docs/credential-setup.md) — get API credentials and configure the CLI
- [Contributing](CONTRIBUTING.md) — dev setup, demo fixtures, tests, releases, DCO sign-off
- [Support](SUPPORT.md) — troubleshooting, bug reports, security disclosure path
- [Agents](AGENTS.md) — entry point for Cursor, aider, OpenCode, and other AI runtimes
- [Product Requirements](docs/PRD.md) — internal product context
- [UX Guide](docs/UX_GUIDE.md) — command patterns and agent-facing contract (contributor reference)
- [`@pax8/core` library](packages/core/README.md) — using the business logic without the CLI
- [Pax8 API Reference](https://devx.pax8.com/) — upstream API docs

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0 — see [LICENSE](LICENSE)

---

Pax8 and the Pax8 logo are trademarks of Pax8, Inc.
