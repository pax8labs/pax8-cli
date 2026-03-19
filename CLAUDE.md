# CLAUDE.md — pax8-cli

## Autonomous Build Mode

When following `docs/BUILD.md`, operate fully autonomously:
- **Do NOT ask for permission** to create files, install packages, run builds/tests, or make git commits
- **Do NOT ask for confirmation** on implementation decisions — make reasonable choices and document in commit messages
- **Commit frequently** after each logical unit of work without asking
- **Run all shell commands** (pnpm install, build, test, git) without prompting
- This is an autonomous build — the BUILD.md is the complete spec. Execute it end-to-end.

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
