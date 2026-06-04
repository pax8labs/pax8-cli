# @pax8/cli

An open-source CLI for Pax8 partners that turns the raw marketplace API into computed answers — renewals, invoice audits, Pax8-cost analytics, upsell recommendations, and closed-loop order placement. Built for MSPs who want to manage subscriptions, billing, customers, and growth opportunities from the terminal. Designed so humans and AI agents (Claude Code, Cursor, Copilot, scripted pipelines) use the same surface.

## Install

```bash
npm install -g @pax8/cli
# or: pnpm add -g @pax8/cli
# or: yarn global add @pax8/cli
```

Requires Node.js 20+. ESM only.

## Try it without credentials

Demo mode runs every command against an in-memory fixture — no Pax8 account, no API access required:

```bash
PAX8_DEMO=1 pax8 dashboard
PAX8_DEMO=1 pax8 subscriptions renewals --within 30d
PAX8_DEMO=1 pax8 recommendations list
PAX8_DEMO=1 pax8 invoices audit
```

## Authenticate

```bash
pax8 auth login
# prompts for PAX8_CLIENT_ID and PAX8_CLIENT_SECRET (OAuth client credentials)
# stored at ~/.pax8/credentials.json (mode 0600)
```

Or set `PAX8_CLIENT_ID` and `PAX8_CLIENT_SECRET` in your environment.

## What the CLI computes

The Pax8 API is a CRUD layer; this CLI is what turns raw subscriptions, invoices, and products into the questions MSPs actually ask:

- **`pax8 dashboard`** — portfolio overview: monthly Pax8 cost, active subscriptions, top customers, high-priority recommendations.
- **`pax8 subscriptions renewals --within 30d`** — which subscriptions renew in the window, total MRR renewing, days until each renewal. The Pax8 API has no renewals endpoint; the CLI computes from commitment dates.
- **`pax8 invoices audit`** — cross-references invoice line items against active subscriptions to flag overcharges, undercharges, and orphan items with dollar impact. Each discrepancy gets a stable ID for filing via `pax8 invoices dispute --discrepancy <id>`.
- **`pax8 recommendations list`** — gap analysis across each customer's stack against backup / security / identity / productivity categories; estimates additional Pax8 monthly cost if acted on; emits ready-to-execute order parameters (the `orderArgs` argv array is shell-injection-safe).
- **`pax8 recommendations act`** — interactive flow that walks portfolio gaps and places the orders. Closes the loop between insight and action in the same tool.
- **`pax8 cost sim`** — model SKU swaps, quantity changes, and add-product scenarios with monthly/annual MRR delta, *before* placing the order.
- **`pax8 report subscriptions --by vendor`** / **`pax8 report mrr`** / **`pax8 report growth`** — aggregations and trends with annual-to-monthly amortization; emits the partner's cost to Pax8 (not partner-side resale revenue).
- **`pax8 doctor`** — diagnostic health check (Node version, config, API connectivity, credentials).

Every command supports `--json`, `--csv`, and `--quiet`. List commands have `--with-actions` to ride a `{ data, nextActions }` envelope. Write commands take `--idempotency-key <uuid>` for safe retry.

## Agent-first contracts

If you're using this CLI as a tool inside an agent (Claude Code, Cursor, Copilot, etc.):

- **`--json` is non-TTY-aware**: subprocess invocations auto-emit JSON even without the flag. Pipelines like `pax8 dashboard | jq` work cleanly — stdout is data only, spinners and banners stay on stderr.
- **Machine-readable error codes**: every `CliError` carries a stable `code` (`ERROR_API_VALIDATION`, `ERROR_COMPANY_NOT_FOUND`, etc.) so agents can branch on outcome without parsing strings.
- **`nextActions[]` argv-safe contract**: each entry has both a `command` (display string) and `args` (argv array starting with `"pax8"`). Agents should spawn `args.slice(1)` directly via their tool's argv form — never tokenize the display string.
- **Read/write safety contract**: see [`packages/claude-skill/skill.md`](https://github.com/pax8labs/pax8-cli/blob/main/packages/claude-skill/skill.md). Every write command requires explicit user approval unless `-y` / `--yes` / `PAX8_YES=1` is set.
- **`@pax8/claude-skill`** ships the agent-facing skill manifest as an installable package; the contracts apply whether the skill is loaded or not.

## Versioning

**Experimental.** `@pax8/cli` is currently `0.x` and the public surface (commands, flags, JSON envelope shapes) may change between minor versions. Pin a specific version (`"@pax8/cli": "0.1.1"`, not `"^0.1.0"`) until the CLI reaches `1.0`. Breaking changes will be called out in release notes.

## Source

- **Repository:** [pax8labs/pax8-cli](https://github.com/pax8labs/pax8-cli)
- **Full feature tour and demo flow:** see the [repo README](https://github.com/pax8labs/pax8-cli#readme)
- **Per-package changelogs:** [CLI](https://github.com/pax8labs/pax8-cli/blob/main/packages/cli/CHANGELOG.md) · [Core SDK](https://github.com/pax8labs/pax8-cli/blob/main/packages/core/CHANGELOG.md)
- **Issues and feature requests:** [GitHub issues](https://github.com/pax8labs/pax8-cli/issues)

The `@pax8/core` package (the durable, interface-agnostic business logic) is published separately at [`@pax8/core`](https://www.npmjs.com/package/@pax8/core) and is suitable for embedding in portals, Lambdas, or partner tooling.

## License

Apache-2.0
