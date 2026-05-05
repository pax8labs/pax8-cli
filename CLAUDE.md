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
| act on a recommendation | Extract `orderCommand` from `pax8 recommendations list --json` and run it (confirm with user first), or use `pax8 recommendations act` for the interactive flow. |
| invoice dispute | `pax8 invoices dispute --discrepancy <id>` (after `invoices audit` returns the id) |
| diagnostics / health | `pax8 doctor --json 2>/dev/null` |

MRR math: monthly subs = price × qty. Annual subs = price × qty ÷ 12. Group by companyId, resolve names from companies list.

Rules: No clarifying questions. Parallel calls when possible. Lead with the key number. Short tables, omit UUIDs. Only confirm writes.

---

## What is this project?

An open-source CLI for MSPs that turns the Pax8 marketplace API (raw CRUD) into computed answers — renewals, invoice audits, MRR analytics, upsell recommendations, closed-loop order placement. The durable asset lives in `packages/core` and is interface-agnostic.

Pax8 also runs a hosted MCP server at `mcp.pax8.com` (see `.mcp.json`). The two are complementary: this CLI has the richer command surface and demo mode; the Pax8 MCP has zero-install access from Claude/Cursor/Copilot/VSCode. See `README.md` for the user-facing comparison and `docs/UX_GUIDE.md` §12 for how the CLI is designed for both human and agent consumers.

## Autonomous Build Mode

This mode applies only when explicitly following `docs/BUILD.md`. Default behavior is conservative — confirm before destructive or shared-state actions.

When following `docs/BUILD.md`, operate fully autonomously with ZERO human interaction:
- NEVER ask questions, for permission, or for confirmation.
- NEVER stop to explain what you're about to do. Just do it.
- If something breaks, fix it yourself. If a test fails, fix the test or the code.
- If a dependency is missing, install it. If a config is wrong, fix it.
- Commit after every numbered build step. Run `pnpm build && pnpm test` before each commit.
- Go fast. Minimize tool calls. Batch related changes.

## Key commands

```bash
pnpm install                                            # Install all dependencies
pnpm build                                              # Build all packages
pnpm test                                               # Run all tests
pnpm test packages/cli/src/__tests__/invoices.test.ts   # Run one test file
pnpm test --run -t "should audit"                       # Run by name pattern
pnpm test:coverage                                      # Run tests with coverage report
pnpm lint                                               # Lint all packages
pnpm dev                                                # Run CLI in dev mode
```

## Architecture

- **Monorepo** with pnpm workspaces: `packages/cli`, `packages/core`, `packages/claude-skill`
- **`@pax8/core`** — API client, auth, services, types. Zero CLI dependencies.
- **`@pax8/cli`** — Commander.js commands, formatting, UX. Imports only from core.
- **`@pax8/claude-skill`** — Claude Code skill wrapping CLI commands as AI tools.

## Conventions

`docs/UX_GUIDE.md` is the source of truth for command patterns, output formatting, error handling, and the agent-facing contracts. **Read it before adding or modifying any command.** Highlights:

- TypeScript strict mode, Zod for validation
- Every command supports `--json`, `--csv`, `--quiet`. List/summary commands also support `--with-actions` to wrap output in `{ data, nextActions }` for tool chaining.
- Errors throw `CliError` with a `code` (one of the `ERROR_*` constants from `@pax8/core`). `--json` mode serializes errors as structured objects on stderr.
- Writes accept `--idempotency-key <uuid>`, wrap their API call with `markWriteInFlight()`, and prompt unless `-y` / `PAX8_YES=1` is set.
- SIGINT exits 130; active spinners stop cleanly without `✗`.
- Stdout for data, stderr for everything else (spinners, hints, banners).
- Demo mode (`PAX8_DEMO=1`) works for every command and is what the test suite runs under.
- Tests: Vitest with subprocess integration tests in `packages/cli/src/__tests__/`.

## Pax8 API Reference

- Base URL: `https://api.pax8.com/v1/`
- Auth: OAuth 2.0 client credentials → `POST /v1/token`
- Rate limit: 1,000 calls/minute
- Docs: https://devx.pax8.com/

## References

- `docs/UX_GUIDE.md` — command patterns and agent contracts (read before adding commands)
- `docs/PRD.md` — product requirements
- `docs/BUILD.md` — autonomous build mode (mode-specific instructions)
- `packages/core/README.md` — `@pax8/core` as a standalone embeddable library
- `.mcp.json` — Pax8 hosted MCP server config (separate AI surface, complementary to this CLI)
