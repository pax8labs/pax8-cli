# @pax8/claude-skill

A [Claude Code](https://claude.ai/code) skill that wraps [`@pax8/cli`](../cli) commands as agent-callable tools, so AI agents get the same computed intelligence (renewals, invoice audits, Pax8-cost analytics, recommendations) as human operators without reimplementing business logic.

## Why this exists alongside the hosted Pax8 MCP

Pax8 publishes a hosted MCP server at `mcp.pax8.com` for zero-install AI access. This skill is the alternative when you want the CLI's richer command surface (recommendations, invoice audit, Pax8-cost analytics, demo mode) or are scripting against a stable, versioned interface. See [When to use this CLI vs the Pax8 MCP](../../README.md#when-to-use-this-cli-vs-the-pax8-mcp) in the root README for the full comparison.

## What you get

The skill exposes the following CLI command groups as agent tools (see [`src/tools/`](./src/tools)):

- **clients** (also exposed as the deprecated `companies` alias) — list, show, drill into customer details
- **subscriptions** — list, show, renewals tracking
- **invoices** — list and audit billing discrepancies
- **products** — catalog search
- **recommendations** — prioritized growth opportunities with ready-to-run order commands
- **reports** — Pax8-cost analytics (renewals, concentration, subscription rollups)

All tools return structured JSON for downstream agent reasoning.

## Setup

See [Setup (Claude Code)](../../README.md#setup-claude-code) in the root README for installation. The skill is auto-discovered by Claude Code once `@pax8/cli` is installed and on `PATH`.

## Behavioral contract

The agent-facing rules (act first, no clarifying questions, parallel fetches, mandatory order previews, output flag conventions, workflow recipes, error handling) live in [`skill.md`](./skill.md). That file is the source of truth for how Claude is instructed to use the CLI.

## License

Apache-2.0 — see [LICENSE](../../LICENSE) at the repo root.
