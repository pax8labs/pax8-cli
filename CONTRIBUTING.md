# Contributing to pax8-cli

Thanks for your interest in contributing! This guide covers the basics.

## Development Setup

```bash
git clone https://github.com/pax8labs/pax8-cli.git
cd pax8-cli
pnpm install
pnpm build
pnpm test
```

### Demo Mode

Run any command without API credentials:

```bash
PAX8_DEMO=1 pnpm dev -- companies list
PAX8_DEMO=1 pnpm dev -- subscriptions renewals --within 14d
```

## Project Structure

```
packages/
  core/          # API client, auth, services, types (zero CLI deps)
  cli/           # Commander.js commands, formatting, UX
  claude-skill/  # Claude Code skill wrapping CLI as AI tools
```

## Code Style

- TypeScript strict mode
- Prettier for formatting (`pnpm format`)
- ESLint for linting (`pnpm lint`)
- Zod for all schema validation
- Every command supports `--json`, `--csv`, `--quiet`
- Errors must include causes and recovery steps (use `CliError`)
- Spinners on stderr, data on stdout

## Testing

```bash
pnpm test              # Run all tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # With coverage report
```

- Unit tests alongside source files (`*.test.ts`)
- CLI integration tests in `packages/cli/src/__tests__/` (subprocess tests with `PAX8_DEMO=1`)
- E2E flow tests in `e2e/`

## Pull Requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Run `pnpm build && pnpm test` before submitting
4. Keep PRs focused — one feature or fix per PR
5. Use descriptive commit messages

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
