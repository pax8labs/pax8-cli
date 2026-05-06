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
# macOS / Linux
PAX8_DEMO=1 pnpm dev -- companies list
PAX8_DEMO=1 pnpm dev -- subscriptions renewals --within 14d

# PowerShell
$env:PAX8_DEMO="1"; pnpm dev -- companies list
$env:PAX8_DEMO="1"; pnpm dev -- subscriptions renewals --within 14d
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

## Releases

We use [Changesets](https://github.com/changesets/changesets) to manage versions and changelogs for the published packages (`@pax8/cli` and `@pax8/core`). `@pax8/claude-skill` is not published to npm.

When your PR has user-visible changes, add a changeset alongside your code:

```bash
pnpm changeset
```

Pick the affected packages, the bump type (`patch` / `minor` / `major`), and write a short summary in the imperative mood ("Add X", "Fix Y"). Commit the generated `.changeset/*.md` file with the rest of your PR.

On merge to `main`, the release workflow opens (or updates) a `chore: release` PR that bumps versions and updates `CHANGELOG.md`. Merging that PR publishes to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements) attestations.

### Maintainer note: npm trusted publishing

The release workflow publishes via [npm OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers) — no `NPM_TOKEN` secret. For this to work, the `@pax8` scope must have the `pax8labs/pax8-cli` repository and the `Release` workflow registered as a trusted publisher at <https://www.npmjs.com/settings/pax8/packages> for every package the workflow publishes (`@pax8/cli`, `@pax8/core`). The workflow already declares `permissions.id-token: write` and `setup-node`'s `registry-url`; once the npm side is configured, `npm publish` exchanges the OIDC token for an ephemeral publish token automatically.

## Reporting Issues

Use GitHub Issues. Include:
- What you expected vs. what happened
- CLI version (`pax8 version`)
- Steps to reproduce
- Relevant command output (with `--verbose` if applicable)
