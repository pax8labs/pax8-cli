# Contributing to pax8-cli

Thanks for your interest in contributing! Outside contributions are welcome — issues, discussion, bug fixes, and features are all fair game. There is no CLA. We use a [Developer Certificate of Origin](https://developercertificate.org) sign-off instead (`git commit -s`); see below.

## Development Setup

```bash
git clone https://github.com/pax8labs/pax8-cli.git
cd pax8-cli
pnpm install

# Recommended dev workflow runs entirely against demo data — no API credentials
# required, no network egress beyond local filesystem.
PAX8_DEMO=1 NO_COLOR=1 pnpm test
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
5. Sign off every commit with the DCO (see below) and use [Conventional Commits](https://www.conventionalcommits.org) for the subject line
6. The repo ships [issue templates](.github/ISSUE_TEMPLATE/) and a [PR template](.github/pull_request_template.md) — please use them so reviewers have what they need

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org):

```
feat: add subscription scheduling
fix: correct invoice audit overcharge calculation
docs: update README with demo mode examples
chore: upgrade vitest to v4
```

## Developer Certificate of Origin (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org) instead of a CLA. Every commit must be signed off, which certifies that you authored the change (or have the right to submit it under the project's Apache-2.0 license).

```bash
git commit -s -m "feat: add subscription scheduling"
```

The `-s` flag appends a `Signed-off-by: Your Name <your@email>` trailer using your `user.name` / `user.email` git config. PRs without sign-off on every commit will be asked to amend before merge. There is no CLA.

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

## Security Reports

Do **not** open a GitHub Issue for security vulnerabilities. Report them via the process in [SECURITY.md](SECURITY.md) (email to `security@pax8.com`).

## Reporting Issues

Use GitHub Issues. Include:
- What you expected vs. what happened
- CLI version (`pax8 version`)
- Steps to reproduce
- Relevant command output (with `--verbose` if applicable)
