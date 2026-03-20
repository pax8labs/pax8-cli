# CLAUDE.md — pax8-cli

## Autonomous Build Mode

When following `docs/BUILD.md`, operate fully autonomously with ZERO human interaction:
- **NEVER ask questions, for permission, or for confirmation.** Not for file creation, package installation, build/test execution, git commits, design decisions, or anything else.
- **NEVER stop to explain what you're about to do.** Just do it.
- **NEVER present options or ask "should I...?"** — make the simpler choice and move on.
- **If something breaks, fix it yourself.** Diagnose the error, fix the code, re-run tests, commit. Do not stop to report the error.
- **If a test fails, fix the test or the code.** Do not ask which one to fix — read the error and determine the right fix.
- **If a dependency is missing, install it.** If a config is wrong, fix it. If a type doesn't match, update it.
- **Commit after every numbered build step** in BUILD.md. Run `pnpm build && pnpm test` before each commit. If either fails, fix before committing.
- **Go fast.** Minimize tool calls. Create multiple files per step when possible. Batch related changes.
- Your output should be almost entirely tool calls (file writes, bash commands). Minimal text narration.
- The BUILD.md is the complete spec. Execute it from step 1 to step 38, then run the quality checklist.

## What is this project?

An open-source CLI tool for MSPs to manage Pax8 cloud marketplace operations (subscriptions, billing, customers, products) from the terminal. See `docs/PRD.md` for full product requirements.

## How to build autonomously

Read `docs/BUILD.md` — it contains the complete autonomous build prompt with exact implementation order, code patterns, test requirements, and quality checklist. Follow it step by step, committing after each numbered build step.

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

- TypeScript strict mode throughout
- Zod for all API response validation and config schemas
- Every command supports `--json`, `--csv`, `--quiet` output flags
- Errors always include causes and recovery steps (never raw stack traces)
- Demo mode (`PAX8_DEMO=1`) works for every command with realistic mock data
- Tests: Vitest with subprocess integration tests for CLI commands
- Spinners on stderr, data on stdout (never mix)
- OS keychain for credential storage, env vars as fallback

## Pax8 API Reference

- Base URL: `https://api.pax8.com/v1/`
- Auth: OAuth 2.0 client credentials → `POST /v1/token`
- Rate limit: 1,000 calls/minute
- Docs: https://devx.pax8.com/

## Pax8 data queries (IMPORTANT — read this)

When the user asks about their Pax8 data (companies, subscriptions, MRR, recommendations, invoices, products), **run `pax8` CLI commands directly via Bash. Do NOT use the /pax8 skill.** The `pax8` binary is on PATH.

**Act immediately** — run the command in your FIRST response. No preamble, no "let me fetch that for you".

Common commands (always add `--json` and pipe through `2>/dev/null`):
```
pax8 companies list --json
pax8 subscriptions list --json --size 1000
pax8 subscriptions renewals --json --within 30d
pax8 invoices list --json
pax8 invoices audit --json
pax8 products search "query" --json
pax8 recommendations list --json
pax8 orders create --company <id> --product <id> --quantity <n>
```

For MRR: run `pax8 subscriptions list --json --size 1000` and `pax8 companies list --json` **in parallel**, then compute MRR (monthly: price×qty, annual: price×qty/12) and group by company.

Rules:
- **No clarifying questions.** Default to all companies, current month, 30 days.
- **Parallel Bash calls** when you need data from multiple commands.
- **Be concise.** Lead with the key number. Top 3-5 items in a short table. Omit UUIDs.
- **Only confirm writes** (orders, updates). Reads need zero confirmation.
