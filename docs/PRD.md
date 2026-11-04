# Pax8 CLI — Product Requirements Document

## Overview

An open-source, cross-platform CLI tool for Managed Service Providers (MSPs) to manage their Pax8 cloud marketplace operations from the terminal. The CLI wraps the Pax8 REST API with smart defaults, computed intelligence, and automation capabilities that go beyond what the raw API or web portal offer.

**Target users:** MSPs managing cloud subscriptions, licensing, and billing across multiple customer tenants via Pax8.

**Project name:** `pax8` (CLI binary name)

---

## Problem Statement

MSPs using Pax8 today face:

1. **Manual, portal-heavy workflows** — seat changes, renewal tracking, and billing reconciliation all require logging into the Pax8 web UI
2. **No CLI or scriptable interface** — the only programmatic options are raw REST calls or community PowerShell modules (Windows-only, limited scope)
3. **Critical automation gaps** — the API lacks scheduling, bulk operations, and renewal management, forcing manual intervention for the highest-stakes workflows (NCE renewals, license optimization)
4. **Fragmented tooling** — MSPs cobble together Power Automate flows, PowerShell scripts, and PSA sync to approximate what a single well-designed tool could provide
5. **No AI-assisted operations** — no way to use natural language to query or manage Pax8 data

---

## Design Principles

### 1. Zero-friction onboarding
- `pax8 auth login` with client credentials is all that's needed to start
- First command auto-detects missing config and guides the user
- Demo mode available without credentials for exploration

### 2. Smart by default
- Commands infer context and do the right thing without flags when possible
- `pax8 subscriptions list` for a partner with one company doesn't require `--company`
- Date ranges default to sensible windows (current month for invoices, next 30 days for renewals)
- Output format auto-detects: table for TTY, JSON for pipes

### 3. Transparency over magic
- Every API call is explainable: `--verbose` shows exactly what's happening
- Destructive operations (cancel, quantity reduction) require explicit confirmation
- Rate limit status is visible, not hidden
- When something can't be done via API, the CLI says so clearly and explains why

### 4. Composable and scriptable
- All commands support `--json` and `--csv` output
- Exit codes are meaningful and documented
- Designed for shell pipelines: `pax8 subscriptions list --json | jq '.[] | select(.quantity > 10)'`
- Silent mode (`--quiet`) for cron jobs

### 5. Actionable errors
- Every error includes what went wrong, why, and what to do next
- Structured error output with recovery steps (following agentsync patterns)
- Link to relevant Pax8 docs or portal pages when the CLI can't help

### 6. Progressive disclosure
- Simple commands stay simple: `pax8 clients list`
- Power features are discoverable but not in the way: `--renewing-within`, `--include-usage`, `--bulk`
- Help text includes real-world examples, not just flag descriptions

### 7. Offline-capable intelligence
- Computed analytics (MRR, renewal reports, license audits) are built client-side from raw API data
- Local scheduling for future-dated changes the API doesn't support
- Caching layer for expensive/stable data (product catalog, company list)

---

## Architecture

### Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Matches team expertise (agentsync), rich ecosystem, good DX |
| CLI framework | Commander.js | Proven in agentsync, clean subcommand model |
| HTTP client | undici / node-fetch | Fast, built-in retry + rate-limit handling |
| Output | chalk + cli-table3 + ora | Consistent with agentsync patterns |
| Config | YAML (fleet) + JSON (user settings) | Human-readable, version-controllable |
| Auth storage | OS keychain (keytar) + env var fallback | Secure credential storage |
| Validation | Zod | Schema validation for config and API responses |
| Testing | Vitest | Subprocess integration + unit tests |
| Build | tsup | Fast bundling to single executable |
| Distribution | npm + GitHub Releases (standalone binaries) | Widest reach for MSP audience |

### Package Structure (monorepo)

```
packages/
  cli/          # CLI commands, formatting, UX
  core/         # API client, auth, services, business logic
  claude-skill/ # Claude Code skill definition for AI-assisted operations
```

### Core Modules

```
core/
  auth/
    token-manager.ts     # OAuth 2.0 client credentials, token caching (24h TTL)
    credential-store.ts  # Keychain + env var + .env fallback chain
  api/
    client.ts            # Base HTTP client with retry, rate-limit, pagination
    companies.ts         # Company endpoints
    contacts.ts          # Contact endpoints
    products.ts          # Product catalog + pricing
    orders.ts            # Order creation and listing
    subscriptions.ts     # Subscription lifecycle
    invoices.ts          # Invoice and line item queries
    usage.ts             # Usage summary endpoints
    quotes.ts            # Quote management
    webhooks.ts          # Webhook configuration
  services/
    renewal-tracker.ts   # NCE renewal intelligence (computed from subscription data)
    invoice-auditor.ts   # Billing reconciliation and anomaly detection
    license-optimizer.ts # Over-provisioning detection
    scheduler.ts         # Local scheduler for future-dated changes
    bulk-executor.ts     # Parallel operations with rate-limit awareness
    analytics.ts         # MRR, growth, churn computations
    cache.ts             # Local cache for product catalog, company list
  config/
    schema.ts            # Zod schemas for config validation
    loader.ts            # Config file discovery and loading
```

---

## Command Reference

### Authentication

```
pax8 auth login                    # Store credentials (interactive or --client-id/--client-secret)
pax8 auth status                   # Show current auth state, token expiry
pax8 auth logout                   # Clear stored credentials
```

**Behavior:**
- Credentials stored in OS keychain by default, with `--env-only` flag to skip
- Token auto-refreshes transparently on every command
- Missing/expired auth triggers helpful setup guidance

### Companies

```
pax8 clients list                        # List all companies
pax8 clients show <id|name>              # Company details
pax8 clients show <id|name> --subscriptions  # Include active subscriptions
pax8 clients create --name "Acme Corp"   # Create new company
pax8 clients update <id> --name "New Name"
```

**Smart behaviors:**
- Fuzzy name matching: `pax8 clients show acme` finds "Acme Corp LLC"
- `show` auto-includes subscription summary (count + estimated MRR) without extra flags
- `list` shows inline estimated MRR per company when data is cached

### Contacts

```
pax8 contacts list --company <id|name>
pax8 contacts show <id>
pax8 contacts create --company <id|name> --first "Jane" --last "Doe" --email "jane@acme.com"
pax8 contacts update <id> --email "new@acme.com"
pax8 contacts delete <id>
```

### Subscriptions

```
pax8 subscriptions list [--company <id|name>]
pax8 subscriptions show <id> [--history]
pax8 subscriptions update <id> --quantity <n>
pax8 subscriptions cancel <id>
```

**Renewal tracking (computed — fills API gap):**
```
pax8 subscriptions renewals [--within <days>]    # Default: 30 days
pax8 subscriptions renewals --within 7d --action-required
```

Output:
```
┌─────────────────────┬──────────────────────────┬──────────┬─────────────┬────────────┐
│ Company             │ Product                  │ Quantity │ Renews      │ Term       │
├─────────────────────┼──────────────────────────┼──────────┼─────────────┼────────────┤
│ Acme Corp           │ M365 Business Premium    │ 45       │ in 6 days   │ Annual     │
│ Contoso Ltd         │ M365 E3                  │ 120      │ in 12 days  │ Annual     │
│ Fabrikam            │ Exchange Online Plan 1   │ 8        │ in 28 days  │ Monthly    │
└─────────────────────┴──────────────────────────┴──────────┴─────────────┴────────────┘

⚠ 2 annual subscriptions renewing within 14 days. Review quantities before lock-in.
```

**Scheduled changes (local scheduler — fills API gap):**
```
pax8 subscriptions schedule <id> --quantity <n> --on <date>
pax8 subscriptions schedule list
pax8 subscriptions schedule cancel <schedule-id>
```

Stores scheduled changes locally and executes via `pax8 scheduler run` (designed for cron).

### Orders

```
pax8 orders list [--company <id|name>]
pax8 orders show <id>
pax8 orders create --company <id|name> --product <id|name> --quantity <n>
pax8 orders create --from <yaml-file>         # Bulk order from file
```

**Smart behaviors:**
- Product lookup by name: `--product "Microsoft 365 Business Premium"` resolves to product ID
- `--dry-run` shows what would be ordered with pricing before confirming
- Bulk orders from YAML file with validation and preview

### Invoices

```
pax8 invoices list [--month <YYYY-MM>] [--company <id|name>]
pax8 invoices show <id>
pax8 invoices items [--month <YYYY-MM>] [--company <id|name>]
pax8 invoices export --month <YYYY-MM> --format csv
```

**Billing audit (computed — fills API gap):**
```
pax8 invoices audit [--month <YYYY-MM>]
```

Compares invoice line items against active subscription quantities to flag discrepancies:
```
⚠ 3 discrepancies found in March 2026 invoices:

  Acme Corp — M365 Business Premium
    Invoiced: 50 seats    Active: 45 seats    Δ +5 ($75.00 overcharge)

  Contoso — Exchange Online Plan 1
    Invoiced: 10 seats    Active: 12 seats    Δ -2 ($16.00 undercharge)

  Fabrikam — Azure AD Premium P1
    Invoiced: 0 seats     Active: 5 seats     Δ -5 (missing from invoice)
```

### Products

```
pax8 products search <query> [--vendor <name>]
pax8 products show <id> [--pricing] [--provisioning] [--dependencies]
pax8 products list [--vendor <name>]
```

**Smart behaviors:**
- Full-text search across product names
- `show --pricing` includes partner cost and recommended retail
- Caches product catalog locally (refreshes daily) for fast offline search

### Usage

```
pax8 usage list [--company <id|name>] [--month <YYYY-MM>]
pax8 usage show <summary-id> [--lines]
```

### Quotes

```
pax8 quotes list
pax8 quotes show <id>
pax8 quotes create --company <id|name> --from <yaml-file>
pax8 quotes update <id> --from <yaml-file>
pax8 quotes delete <id>
```

### Webhooks

```
pax8 webhooks list
pax8 webhooks create --url <url> --topics <topic,...>
pax8 webhooks test <id> [--topic <topic>]
pax8 webhooks logs <id>
pax8 webhooks delete <id>
```

### Reports (computed — fills API gap)

The original PRD enumerated four `pax8 report …` commands (mrr / renewals /
growth / licenses) framed around partner-revenue MRR. That framing was
retired pre-v0.1.0 review (#443 — Bret Pittenger reshape) because Pax8's
internal Unified Semantic Layer (Voyager Alliance) reserves the
"Partner Gross MRR" term for the partner's **cost paid to Pax8**, not
their resale revenue. The current surface mirrors that taxonomy:

```
pax8 report subscriptions --by company|product|vendor  # Pax8-cost grouped
pax8 report concentration                              # Customer-concentration risk
pax8 report renewals [--within <days>]                 # Renewal calendar
pax8 subscriptions renewals                            # Same surface, daily-workflow shape
pax8 dashboard                                         # Portfolio Pax8-cost summary
```

Historical `pax8 report mrr` and `pax8 report growth` were removed in
#443; `computeMrr` / `computeGrowth` remain in `@pax8/core` for
embeddable reuse (v0.2 reporting work).

### Configuration

```
pax8 config init                   # Interactive setup wizard
pax8 config show                   # Display current configuration
pax8 config set <key> <value>      # Set a config value
pax8 config path                   # Show config file location
```

**Config file:** `~/.pax8/config.yaml`

```yaml
version: "1.0"
auth:
  client_id: "..."
  # client_secret stored in keychain, not in file
defaults:
  output_format: table    # table | json | csv
  page_size: 50
  confirm_destructive: true
cache:
  enabled: true
  ttl_hours: 24
  path: ~/.pax8/cache
scheduler:
  enabled: false
  state_path: ~/.pax8/schedules.json
```

### Utility

```
pax8 version                       # Version info
pax8 doctor                        # Diagnose common issues (auth, connectivity, config)
pax8 completions <shell>           # Generate shell completions (bash, zsh, fish)
```

---

## Claude Skill (AI-Assisted Operations)

The CLI ships with a Claude Code skill (`@pax8/claude-skill`) that enables natural-language interaction with Pax8 data directly from Claude Code. This is distributed as part of the open-source project and installable as a Claude Code skill.

### Skill Capabilities

The skill exposes Pax8 CLI commands as tools that Claude can invoke, enabling conversational workflows:

```
User: "Which of my customers have Microsoft 365 subscriptions renewing in the next 2 weeks?"

Claude: [invokes pax8 subscriptions renewals --within 14d --json]
        "You have 3 customers with M365 renewals in the next 14 days:
         - Acme Corp: 45 seats of Business Premium, renews March 25
         - Contoso: 120 seats of E3, renews March 28
         - Fabrikam: 8 seats of E3, renews April 1
         Acme is the most urgent. Want me to check if their seat count matches actual usage?"
```

### Skill Design

```
packages/claude-skill/
  skill.md              # Skill definition with trigger patterns and instructions
  tools/
    companies.ts        # Tool definitions wrapping CLI commands
    subscriptions.ts
    invoices.ts
    products.ts
    reports.ts
```

**Trigger patterns:**
- References to Pax8, MSP operations, cloud subscriptions, licensing
- Questions about customers, billing, renewals, seat counts
- Requests to look up products or pricing

**Tool definitions** wrap CLI commands with `--json` output, giving Claude structured data to reason over:

```typescript
// Example tool: subscription renewals
{
  name: "pax8_subscription_renewals",
  description: "List subscriptions approaching renewal with company, product, quantity, and renewal date",
  parameters: {
    within: { type: "string", description: "Time window, e.g. '14d', '30d'" },
    company: { type: "string", description: "Filter by company name or ID", optional: true }
  },
  execute: (params) => `pax8 subscriptions renewals --within ${params.within} --json`
}
```

### Key AI-Assisted Use Cases

| Use Case | What Claude Does |
|----------|-----------------|
| **Renewal triage** | Pulls renewal data, identifies highest-risk renewals (annual, high seat count), recommends actions |
| **Billing investigation** | Runs invoice audit, explains discrepancies in plain language, suggests resolutions |
| **Customer overview** | Combines company, subscription, and invoice data into a narrative summary |
| **Order assistance** | Looks up products, checks pricing, helps construct orders with confirmation |
| **What-if analysis** | "What would it cost to upgrade Acme from Business Basic to Business Premium?" — pulls pricing and computes delta |
| **Anomaly detection** | "Anything unusual in this month's billing?" — runs audit and flags outliers |

### Distribution

- Published as an npm package: `@pax8/claude-skill`
- Installable via Claude Code: references the skill from the package
- Self-contained: includes tool definitions, system prompt, and trigger patterns
- Requires `pax8` CLI to be installed and authenticated

---

## API Gap Analysis

### Gaps the CLI Can Fill (client-side intelligence)

These are limitations of the Pax8 API that the CLI works around with local computation, caching, or scheduling.

| Gap | CLI Solution | Implementation |
|-----|-------------|----------------|
| **No future-dated changes** | Local scheduler: `pax8 subscriptions schedule` stores intent, executes via cron at target date | `scheduler.ts` — SQLite or JSON state file, `pax8 scheduler run` for cron execution |
| **No bulk/batch API** | Parallel executor with rate-limit awareness: `pax8 orders create --from bulk.yaml` | `bulk-executor.ts` — concurrent API calls with configurable parallelism (default 5), automatic backoff on 429 |
| **No reporting/analytics** | Computed reports: `pax8 report subscriptions`, `pax8 report concentration`, `pax8 report renewals` (Pax8-cost framed per #443) | `analytics.ts` — pulls raw subscription/invoice data, computes Pax8 cost / renewal exposure / concentration client-side |
| **No renewal intelligence** | `pax8 subscriptions renewals` — parses `commitmentTermEndDate` across all subscriptions | `renewal-tracker.ts` — aggregates subscription data, sorts by urgency, flags action-required items |
| **No billing reconciliation** | `pax8 invoices audit` — diffs invoice line items against active subscription quantities | `invoice-auditor.ts` — cross-references invoice items with subscription state, flags discrepancies |
| **No product search** | `pax8 products search` — local full-text search over cached product catalog | `cache.ts` — daily product catalog sync, fuzzy matching |
| **No license count analysis** | `pax8 report licenses` — aggregates seat counts across companies, identifies outliers | `license-optimizer.ts` — subscription quantity analysis (note: cannot determine per-user utilization without Graph API) |
| **No credit tracking** | `pax8 invoices audit` — identifies negative line items and tracks them as credits | Part of `invoice-auditor.ts` — parses negative amounts from invoice items |

### Gaps That Require Pax8 API Changes

These are limitations that **cannot be worked around** in the CLI. They represent missing API endpoints or fields that Pax8 would need to add.

| Gap | What's Missing | Blocked Use Cases | Value | Required API Change |
|-----|---------------|-------------------|-------|-------------------|
| **No auto-renew toggle** | `PUT /subscriptions/{id}` has no `autoRenew` field | Cannot automate NCE renewal management — the single highest-stakes MSP workflow | **Critical** | Add `autoRenew: boolean` to subscription update payload |
| **No per-user license data** | No endpoint for user-level license assignments | Cannot determine which specific users hold which licenses; can only see aggregate seat counts | **Critical** | New endpoint: `GET /subscriptions/{id}/assignments` or integration with vendor (Microsoft Graph) data |
| **No license utilization** | Usage endpoints are for consumption billing, not adoption metrics | Cannot identify unused licenses — the #1 cost-optimization opportunity for MSPs | **Critical** | New endpoint: `GET /subscriptions/{id}/utilization` pulling vendor usage reports |
| **No CSP/GDAP management** | No endpoints for delegated admin relationships, tenant provisioning, or Azure plan management | Cannot manage Microsoft partner relationships or Azure subscriptions through Pax8 | **High** | New endpoint family: `/csp/relationships`, `/csp/tenants`, `/azure/plans` |
| **No NCE mid-term SKU changes** | Cannot change product SKU within a commitment term | Cannot upgrade/downgrade Microsoft plans mid-term (e.g., Business Basic to Premium) | **High** | Support `productId` changes on `PUT /subscriptions/{id}` with vendor-specific validation |
| **No scheduled operations** | API executes all changes immediately; no `effectiveDate` parameter | Must build fragile external schedulers; can't guarantee execution at renewal boundaries | **High** | Add `effectiveDate: ISO8601` to `PUT /subscriptions/{id}` and `POST /orders` |
| **No PSA sync API** | PSA integrations configured only through portal UI | Cannot monitor sync health, trigger re-syncs, or configure mappings programmatically | **Medium** | New endpoint family: `/integrations/psa` |
| **No credit/refund endpoints** | No dedicated credit or refund resources | Cannot programmatically request credits or track credit status | **Medium** | New endpoints: `GET /credits`, `POST /credits/request` |
| **No support ticket API** | No endpoints for support case management | Cannot create/track support tickets programmatically | **Medium** | New endpoint family: `/support/tickets` |
| **No margin data on invoices** | Invoice line items don't include partner cost vs. retail | Cannot compute actual realized margin per customer from invoice data alone | **Low** | Add `partnerCost`, `retailPrice` fields to invoice item responses |
| **No async/batch endpoint** | All operations are synchronous, single-resource | Bulk operations limited by rate limits and serial execution | **Low** | New endpoint: `POST /batch` accepting array of operations |

### Workaround Matrix

For gaps requiring Pax8 changes, the CLI provides the best available alternative:

| Gap | CLI Workaround | Limitation of Workaround |
|-----|---------------|--------------------------|
| No auto-renew toggle | `pax8 subscriptions renewals` alerts you early; you act in the portal | Still requires manual portal login for the actual toggle |
| No per-user license data | `pax8 report licenses` shows seat counts; flag `--note` to add context | Only aggregate counts, not user-level; recommend Graph API integration separately |
| No license utilization | `pax8 report licenses --underutilized` flags subscriptions with quantity decreases | Heuristic only (quantity went down = someone noticed waste), not true utilization |
| No scheduled operations | `pax8 subscriptions schedule` with local cron | Depends on cron reliability; no guarantee of exact-time execution; no portal visibility |

---

## UX Standards

### Output Formatting

**Table output (default for TTY):**
```
$ pax8 clients list

  Name                 ID                                     Subscriptions   Est. MRR
  Acme Corp            a1b2c3d4-e5f6-7890-abcd-ef1234567890   12             $2,450.00
  Contoso Ltd          b2c3d4e5-f6a7-8901-bcde-f12345678901   8              $8,920.00
  Fabrikam             c3d4e5f6-a7b8-9012-cdef-123456789012   3              $180.00

  3 companies | $11,550.00 total estimated MRR
```

**JSON output (for pipes/scripts):**
```
$ pax8 clients list --json
[{"name":"Acme Corp","id":"a1b2c3d4...","subscriptions":12,"mrr":2450.00}, ...]
```

**CSV output (for spreadsheets):**
```
$ pax8 clients list --csv > clients.csv
```

### Progress & Feedback

- Spinners (ora) on stderr for operations >500ms
- Progress bars for bulk operations with ETA
- Rate-limit awareness: `⚡ 847/1000 API calls remaining this minute`
- Completion summaries: `✓ 12 subscriptions updated across 3 companies (4.2s)`

### Error Messages

Follow agentsync pattern — structured, actionable, never just a stack trace:

```
$ pax8 subscriptions update abc123 --quantity 5

  ✗ Cannot reduce quantity on this subscription

  Why:
  • This is an annual NCE subscription mid-term
  • Seat reductions are only allowed at renewal (March 25, 2026)

  What to do:
  1. Schedule the change for renewal: pax8 subscriptions schedule abc123 --quantity 5 --on 2026-03-25
  2. Or manage auto-renewal in the Pax8 portal: https://app.pax8.com/subscriptions/abc123

  Docs: https://devx.pax8.com/docs/subscription-management
```

### Confirmation Prompts

Destructive operations require confirmation (unless `--yes` flag):

```
$ pax8 subscriptions cancel abc123

  ⚠ Cancel subscription?

  Company:    Acme Corp
  Product:    Microsoft 365 Business Premium
  Quantity:   45 seats
  Est. MRR Impact: -$1,012.50/mo

  This cannot be undone. Type "cancel" to confirm: _
```

### Help Text

Every command includes examples:

```
$ pax8 subscriptions --help

Usage: pax8 subscriptions <command> [options]

Manage Pax8 subscriptions across your customer base.

Commands:
  list       List subscriptions
  show       Show subscription details
  update     Update subscription quantity or billing term
  cancel     Cancel a subscription
  renewals   View upcoming renewals
  schedule   Schedule a future change
  history    View subscription change history

Examples:
  pax8 subscriptions list --company "Acme Corp"
  pax8 subscriptions renewals --within 14d
  pax8 subscriptions update abc123 --quantity 50
  pax8 subscriptions schedule abc123 --quantity 40 --on 2026-04-01
```

---

## Non-Functional Requirements

### Performance
- Command startup <300ms (cold start)
- API responses streamed to output as pages arrive (don't wait for all pages)
- Product catalog cache makes `products search` instant after first load
- Parallel API calls (configurable concurrency, default 5) for bulk operations

### Security
- Credentials in OS keychain by default (keytar)
- Never log or display secrets, tokens, or client_secret values
- `pax8 doctor` checks for credentials in insecure locations (.env committed to git, etc.)
- HTTPS enforced for all API communication

### Reliability
- Automatic retry with exponential backoff on 429 (rate limit) and 5xx errors
- Graceful degradation when cache is stale or unavailable
- Scheduled changes persist across CLI restarts (file-based state)
- `SIGINT` handling: clean shutdown, no partial state

### Compatibility
- Node.js 20+
- macOS, Linux, Windows
- Shell completion for bash, zsh, fish
- Standalone binaries via GitHub Releases (no Node.js required)
- CI-friendly: `--json`, `--quiet`, `--yes`, meaningful exit codes

### Telemetry
- Opt-in only, disabled by default
- Tracks: command names, flag names (not values), duration, success/failure
- Never collects: company IDs, subscription data, credentials, personal information
- Respects `DO_NOT_TRACK` and `PAX8_TELEMETRY_DISABLED` environment variables
- Clear first-run notice explaining what's collected and how to disable

---

## Milestones

### M1 — Foundation (MVP)
- Auth (login, logout, status)
- Companies (list, show, create)
- Subscriptions (list, show, update, cancel)
- Products (list, show, search with pricing)
- Output formatting (table, JSON, CSV)
- Error handling framework
- Config management
- Shell completions
- `pax8 doctor`

### M2 — Intelligence Layer
- Renewal tracking (`subscriptions renewals`)
- Invoice queries + audit (`invoices audit`)
- Orders (create, list, show)
- Contacts CRUD
- Local product catalog cache
- Bulk operations (`--from <file>`)

### M3 — Automation & Reporting
- Local scheduler (`subscriptions schedule` + `scheduler run`)
- Computed reports (MRR, growth, renewals calendar)
- Usage summaries
- Webhook management
- Quote management

### M4 — Claude Skill
- Claude Code skill package
- Tool definitions for all major commands
- AI-assisted workflows (renewal triage, billing investigation, customer overview)
- Published to npm as `@pax8/claude-skill`

---

## Success Metrics

- **Adoption:** GitHub stars, npm weekly downloads, active installs
- **Coverage:** % of Pax8 API surface exposed through CLI commands
- **Time saved:** Reduction in portal logins for common operations (measured via community feedback)
- **Community:** PRs from non-core contributors, GitHub issues with feature requests
- **Skill usage:** Claude skill installs, tool invocation frequency

---

## Open Questions

1. **Naming:** `pax8` is clean but may conflict with Pax8 trademark policy for open-source tools. Alternatives: `p8`, `pax8-cli`, `msp8`. Need to check Pax8's open-source/trademark guidelines.
2. **Microsoft Graph bridge:** Should the CLI optionally integrate with Microsoft Graph for license utilization, or keep scope strictly to Pax8 API? Recommendation: keep it Pax8-only in core, offer Graph integration as a plugin/extension.
3. **Local scheduler persistence:** SQLite vs. JSON file for scheduled changes? JSON is simpler; SQLite scales better for MSPs with thousands of subscriptions.
4. **Rate limit strategy:** Should the CLI expose a `--rate-limit` flag or always auto-manage? Recommendation: auto-manage with `--verbose` visibility.
