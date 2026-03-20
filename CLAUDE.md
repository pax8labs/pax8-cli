# CLAUDE.md — pax8-cli

## Pax8 data queries — ACT FIRST, THINK LATER

When the user asks ANYTHING about Pax8 data (companies, subscriptions, MRR, recommendations, invoices, products), your FIRST action must be a Bash tool call. No thinking preamble. No skill invocation. Just run the command.

| User asks about | Run this |
|---|---|
| overview / status / how am I doing | `pax8 status --json 2>/dev/null` |
| companies / customers | `pax8 companies list --json 2>/dev/null` |
| subscriptions | `pax8 subscriptions list --json --size 1000 2>/dev/null` (add `--status Active` or `--company <name>` as needed) |
| renewals | `pax8 subscriptions renewals --json --within 30d 2>/dev/null` |
| MRR / revenue | `pax8 subscriptions list --json --size 1000 2>/dev/null` AND `pax8 companies list --json 2>/dev/null` (parallel) |
| recommendations / upsell | `pax8 recommendations list --json 2>/dev/null` |
| invoices / billing | `pax8 invoices list --json 2>/dev/null` |
| invoice audit | `pax8 invoices audit --json 2>/dev/null` |
| products / catalog | `pax8 products search "query" --json 2>/dev/null` |
| place an order | `pax8 orders create --company <id> --product <id> --quantity <n>` (confirm first) |
| act on a recommendation | Extract orderCommand from recommendations JSON and run it. Always confirm with the user first. |

MRR math: monthly subs = price × qty. Annual subs = price × qty ÷ 12. Group by companyId, resolve names from companies list.

Rules: No clarifying questions. Parallel calls when possible. Lead with the key number. Short tables, omit UUIDs. Only confirm writes.

---

## What is this project?

An open-source CLI tool for MSPs to manage Pax8 cloud marketplace operations (subscriptions, billing, customers, products) from the terminal. See `docs/PRD.md` for full product requirements.

## Autonomous Build Mode

When following `docs/BUILD.md`, operate fully autonomously with ZERO human interaction:
- NEVER ask questions, for permission, or for confirmation.
- NEVER stop to explain what you're about to do. Just do it.
- If something breaks, fix it yourself. If a test fails, fix the test or the code.
- If a dependency is missing, install it. If a config is wrong, fix it.
- Commit after every numbered build step. Run `pnpm build && pnpm test` before each commit.
- Go fast. Minimize tool calls. Batch related changes.

## Key commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm test:coverage    # Run tests with coverage report
pnpm lint             # Lint all packages
pnpm dev              # Run CLI in dev mode
```

## Architecture

- **Monorepo** with pnpm workspaces: `packages/cli`, `packages/core`, `packages/claude-skill`
- **`@pax8/core`** — API client, auth, services, types. Zero CLI dependencies.
- **`@pax8/cli`** — Commander.js commands, formatting, UX. Imports only from core.
- **`@pax8/claude-skill`** — Claude Code skill wrapping CLI commands as AI tools.

## Conventions

- TypeScript strict mode, Zod for validation
- Every command supports `--json`, `--csv`, `--quiet` output flags
- Demo mode (`PAX8_DEMO=1`) works for every command
- Tests: Vitest with subprocess integration tests
- Spinners on stderr, data on stdout (never mix)

## Pax8 API Reference

- Base URL: `https://api.pax8.com/v1/`
- Auth: OAuth 2.0 client credentials → `POST /v1/token`
- Rate limit: 1,000 calls/minute
- Docs: https://devx.pax8.com/
