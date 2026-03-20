# Contributing to pax8-cli

Thanks for your interest in contributing! This guide covers the basics.

## Prerequisites

- **Node.js 20+**
- **pnpm** (install via `corepack enable` or `npm install -g pnpm`)

## Development Setup

```bash
git clone https://github.com/pax8labs/pax8-cli.git
cd pax8-cli
pnpm install && pnpm build && pnpm test
```

### Demo Mode

Run any command without API credentials:

```bash
PAX8_DEMO=1 pnpm dev -- companies list
PAX8_DEMO=1 pnpm dev -- subscriptions renewals --within 14d
```

## Code Style

- TypeScript strict mode throughout
- Zod for all API response validation and config schemas
- Prettier for formatting: `pnpm format`
- ESLint for linting: `pnpm lint`
- Every command supports `--json`, `--csv`, `--quiet` output flags
- Errors must include causes and recovery steps (use `CliError`)
- Spinners on stderr, data on stdout (never mix)

## Testing

```bash
pnpm test              # Run all tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # With coverage report
```

- Unit tests alongside source files (`*.test.ts`)
- CLI integration tests in `packages/cli/src/__tests__/` (subprocess tests with `PAX8_DEMO=1`)
- E2E flow tests in `e2e/`
- All new code should have accompanying unit tests
- `pnpm test` must pass before submitting a PR

## PR Process

1. Fork the repo and create a feature branch from `main`
2. Make your changes with descriptive commit messages
3. Write tests for new functionality
4. Run `pnpm build && pnpm test` before submitting
5. Open a PR against `main`
6. Keep PRs focused — one feature or fix per PR

## Commit Messages

Follow conventional commits:

```
feat: add subscription scheduling
fix: correct invoice audit overcharge calculation
docs: update README with demo mode examples
chore: upgrade vitest to v4
```

## Reporting Issues

Use GitHub Issues. Include:
- What you expected vs. what happened
- CLI version (`pax8 version`)
- Steps to reproduce
- Relevant command output (with `--verbose` if applicable)
