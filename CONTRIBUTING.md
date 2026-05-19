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

#### Large-portfolio fixture for scale testing

Demo mode defaults to a small hand-curated fixture (~12 companies). For UX
bugs that only manifest at portfolio scale — invisible pagination, 200-cap
name enrichment, currency rendering, BillingTerm normalization, shell-meta
in customer names — set `PAX8_DEMO_SCALE=large` alongside `PAX8_DEMO=1`:

```bash
PAX8_DEMO=1 PAX8_DEMO_SCALE=large pnpm dev -- orders list
PAX8_DEMO=1 PAX8_DEMO_SCALE=large pnpm dev -- dashboard --json
```

You get 1,000 companies, 5,000 subscriptions, 45,000 orders dating back to
2013, mixed currencies (USD/EUR/GBP/CAD), every `BillingTerm` value, and a
handful of deliberately-hostile customer names. The fixture is generated
deterministically from a fixed seed, so two runs produce identical data.

Don't replace the small fixture with the large one — both serve different
purposes. The small fixture is the screenshot target and golden-path test
data; the large fixture is the scale-matrix regression gate (#484).

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
pnpm test              # Run all tests (no credentials required)
pnpm test:watch        # Watch mode
pnpm test:coverage     # With coverage report
pnpm test:integration  # Wire-level smoke tests against the real Pax8 API
```

- Unit tests alongside source files (`*.test.ts`)
- CLI integration tests in `packages/cli/src/__tests__/` (subprocess tests with `PAX8_DEMO=1`)
- E2E flow tests in `e2e/`
- Wire-level integration tests in `e2e/integration/` (real API; opt-in)

### Wire-level integration tests (`pnpm test:integration`)

A small, extensible suite that hits the real Pax8 API and asserts every
call resolves to the URL documented by the relevant OpenAPI spec. Added in
[#308](https://github.com/pax8labs/pax8-cli/issues/308) to close the gap
that allowed the [#307](https://github.com/pax8labs/pax8-cli/issues/307)
quotes `v1`/`v2` regression to ship — no test in the repo exercised a real
wire URL.

**Running locally with credentials:**

```bash
export PAX8_CLIENT_ID=...
export PAX8_CLIENT_SECRET=...
pnpm build              # the suite runs the built CLI, so build first
pnpm test:integration
```

**Without credentials** the suite skips cleanly (exit 0) with a clear stderr
message. The default `pnpm test` never depends on credentials — forks and
local-only contributors are never blocked.

**Adding a smoke test for a new resource:**

1. Pick a read-only command for the resource (`list` is usually the right
   shape). Writes against the real API are out of scope for this suite.
2. Check `https://devx.pax8.com/openapi` for the spec that documents the
   resource and note the version prefix (`/v1`, `/v2`, `/api/v2`, …).
3. Add a file at `e2e/integration/<resource>.integration.test.ts`:

   ```ts
   import { it, expect } from "vitest";
   import {
     describeIntegration,
     runCliVerbose,
     expectExitZero,
     expectWireUrl,
   } from "./harness.js";

   describeIntegration("widgets (v1)", () => {
     it("widgets list hits /v1/widgets", async () => {
       const result = await runCliVerbose(["widgets", "list", "--json"]);
       expectExitZero(result);
       expectWireUrl(result, {
         method: "GET",
         pathContains: "/v1/widgets",
         version: "v1",
       });
     });
   });
   ```

`describeIntegration` skips automatically when credentials are absent.
`runCliVerbose` runs the built CLI with `--verbose` so `Pax8Client` emits
the resolved URL on stderr; `expectWireUrl` parses that line and asserts
the version segment. See `e2e/integration/harness.ts` for the full contract.

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

### Static analysis (CodeQL)

We run [CodeQL](https://codeql.github.com) on every push to `main`, every PR, and a weekly schedule via [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml). The job uses the `javascript-typescript` analysis with the `security-extended` query suite. Findings appear in the repo **Security → Code scanning** tab. If a PR introduces a new finding, the check will fail — fix the issue or, if it's a false positive, dismiss it from the Security tab with a justification.

## Reporting Issues

Use GitHub Issues. Include:
- What you expected vs. what happened
- CLI version (`pax8 version`)
- Steps to reproduce
- Relevant command output (with `--verbose` if applicable)
