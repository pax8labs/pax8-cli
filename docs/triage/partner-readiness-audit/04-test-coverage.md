# 04 — Test coverage

## Methodology

Audited test coverage across three layers: unit tests (API client mocks), subprocess integration tests (CLI commands via `runCli` with `PAX8_DEMO=1`), and wire-level integration tests (real Pax8 API via `runCliVerbose`). Measured coverage via `pnpm test:coverage` (74.22% statements, 59.11% branches). Cross-referenced 78 commands against test files to identify coverage gaps. Checked CI gating (`ci.yml` vs `integration.yml`) and fixture freshness.

## Summary

**Integration test inventory:** 5 wire-smoke tests (companies, quotes, products, subscriptions, invoices) covering only read-only operations. Credentials-gated via `PAX8_CLIENT_ID` / `PAX8_CLIENT_SECRET` env vars; skips cleanly on absent credentials.

**Write operations without integration tests:** 18 write commands tested only via mocked subprocess tests (companies create/update, contacts create/delete/update, orders create, quotes create/delete/send/line-items add+remove, subscriptions cancel/update, webhooks create/delete/enable/disable/update). No real-API coverage for state mutations.

**Measured coverage:** 74.22% statements, 59.11% branches (vs thresholds of 60% / 42%). Core API coverage is 82.69% statements but only 64.78% branches (e.g., `invoices.ts` 55.55% statements, `products.ts` 59.25%). Commands coverage is uneven: `companies.update` 75.58%, `webhooks.logs` 59.45%, `usage.show` 39.21%.

**Top coverage gaps:** (1) Subprocess tests for write operations rely entirely on mocked data and confirm-prompt flows, so malformed payloads or API version mismatches in mutations won't surface until prod. (2) Easter-eggs commands (coffee, moo, time-quip) and `report-bug` have zero test references. (3) Per-command e2e matrix covers only 45% of commands live (read-only excluded due to `isWrite: true` or `skipLiveRun` flag); 29 of 78 commands skip subprocess runs entirely.

## Findings

### block-launch — Integration tests — No wire-level coverage for write operations

**File:** `e2e/integration/` (5 files total)

**Evidence:** 
- Integration test inventory: companies.integration.test.ts, quotes.integration.test.ts, products.integration.test.ts, subscriptions.integration.test.ts, invoices.integration.test.ts
- All 5 tests are read-only (`GET` operations)
- Write operations with only mocked coverage: companies create (2 methods), contacts create/delete/update (3), orders create (1), quotes create/delete/send/add-line-item/remove-line-item (5), subscriptions cancel/update (2), webhooks create/delete/enable/disable/update (7)
- CI gating: `integration.yml` runs on every PR but is `continue-on-error: true` (non-blocking) and behind credentials gate

**Why it matters:**
The harness comment at `e2e/integration/harness.ts:21` explicitly notes that unit tests "mock the client and only assert on relative path strings" and subprocess tests "run with `PAX8_DEMO=1` against `MockPax8Client` — no wire calls at all." The #307 bug (quotes `/v1` vs `/v2`) shipped undetected because no test exercised a real wire URL. Write operations (orders create, quotes send, subscriptions cancel, webhook mutations) have comparable risk: a client version mismatch, payload validation failure, or incorrect HTTP method would ship silently.

**Recommended fix:**
Extend integration test harness to exercise at least one write operation per resource. Candidates: `orders create`, `quotes create` + `send`, `subscriptions cancel`, `webhooks create` + `enable/disable`. These require valid JSON payloads but can reuse demo-data IDs. Add 3–5 new test files under `e2e/integration/` following the pattern in `quotes.integration.test.ts` (one read per resource to validate wire URL, then one idempotent write where feasible). Promote `integration.yml` from `continue-on-error: true` to required once the suite is stable.

---

### fix-before-launch — Unit test layer — Weak branch coverage in API client

**File:** `packages/core/src/api/` (13 test files)

**Evidence:**
- Core API statements: 82.69%, branches: 64.78% (vs threshold 42%, but branches are uneven)
- Invoices: 55.55% statements, 34.61% branches (lines 31, 39, 72, 78–97 untested)
- Products: 59.25% statements, 0% branches (lines 45–50 uncovered)
- Webhooks: 72.72% statements, 57.14% branches (line 145 uncovered)
- Quotes: 77.14% statements, 75% branches (lines 67, 153 — likely error path skipped)
- Subscriptions: 81.81% statements, 75% branches (line 86)
- Contacts: 76.47% statements, 100% branches ✓
- Companies: 81.25% statements, 100% branches ✓
- Orders: 88.23% statements, 100% branches ✓

**Why it matters:**
Low branch coverage in products, invoices, and webhooks APIs means error-handling paths (e.g., pagination edge cases, malformed responses, HTTP error codes) are untested. The products API (0% branches) is particularly exposed. These modules are mocked in subprocess tests, so a regression in error handling won't surface until the CLI hits the real API.

**Recommended fix:**
Add branch-specific test cases to `packages/core/src/api/products.test.ts`, `invoices.test.ts`, and `webhooks.test.ts`. Focus on error paths: empty pagination cursors, null fields, HTTP 4xx/5xx responses. Use the existing mock pattern (vitest `vi.fn()`) to exercise conditional branches. Target 85% branch coverage for each API module pre-launch.

---

### fix-before-launch — Subprocess tests — Easter-eggs and meta-commands uncovered

**File:** `packages/cli/src/__tests__/`

**Evidence:**
- Easter-eggs commands (coffee.ts, moo.ts, time-quip.ts): 0 test references
- report-bug.ts: No dedicated test file (appears in only report-bug.test.ts but minimal coverage)
- completions.ts: No test file
- init.ts (global init): No test file
- These commands are in the CLI build but not in `e2e/command-inventory.ts` or subprocess test suite

**Why it matters:**
Easter-eggs are low-risk (no API calls), but report-bug (which opens a GitHub issue) and completions (shell integration) are integration points. Missing tests mean a typo in the user-facing message or a broken GitHub API call could ship undetected. completions.ts in particular could fail silently if the shell-completion generation logic breaks.

**Recommended fix:**
Add test entries to `e2e/command-inventory.ts` for easter-eggs, completions, and init. For easter-eggs: assert that output contains expected fragments (e.g., cow emoji, time quip). For completions: verify exit 0 and shell syntax. For init: test both interactive (--help) and non-interactive paths. Each takes ~5 lines in the spec.

---

### fix-soon-after-launch — Subprocess tests — Per-command e2e matrix excludes 29 commands

**File:** `e2e/per-command.test.ts`, `e2e/command-inventory.ts`

**Evidence:**
- Read-only commands tested live: ~47 of 78
- Skipped commands (marked `isWrite: true` or `skipLiveRun`): 29
  - Write: companies create, companies update, config init, config set, contacts create/update/delete, orders create, quotes create/update/delete/send, subscriptions cancel/update, webhooks create/delete/enable/disable/update (19)
  - Interactive/destructive: auth login, auth logout, invoices dispute (3)
  - High resource cost: orders list (timeout on large portfolios, #199) (1)
  - Known broken: none currently marked `knownBroken` (0)
- Matrix still runs on every PR (no gating)

**Why it matters:**
Write commands are tested only via `runCliExpectSuccess` with confirm prompts mocked. The matrix skips them entirely (only `--help` runs). This means bugs in write-command argument parsing, JSON serialization, or error messaging won't surface in the subprocess layer. Example: orders create could silently accept invalid `--quantity` values if validation is weak.

**Recommended fix:**
This is acceptable for v0.1.0 (write paths are tested via unit mocks + CI confirm prompts + integration layer pending). Document in CONTRIBUTING.md that new write commands must include subprocess tests for the non-destructive flag-parsing paths (e.g., `quotes create --help`, `orders create --invalid-flag` should exit 1). Defer integration test expansion (real-API writes) to v0.1.1 once the harness stabilizes.

---

### accept — Unit test layer — Mock data is fresh

**File:** `packages/core/src/mock/demo-data.ts`

**Evidence:**
- Spot-check: status, MRR, companyId fields present and consistent with schemas
- MRR calculated correctly in comments (e.g., "Summit Healthcare: 3 subs, ~$2,635 MRR")
- Statuses match API enums: "Active" | "Inactive" | "Deleted" for companies, "Draft" | "Sent" | "Accepted" | "Declined" for quotes
- No stale vocabulary (e.g., no removed fields like "parentCompanyId")
- Mock client invariant tests pass: `packages/core/src/mock/demo-data.invariant.test.ts`

**Why it matters:**
Stale fixture data can hide bugs (e.g., a field type change unnoticed in mocks). The repo passes invariant tests, so fixtures are in sync with current schemas.

**Recommended fix:**
No action. Consider adding a pre-commit hook to run `packages/core/src/mock/demo-data.invariant.test.ts` before every merge (already runs in CI, but a local guard is cheap).

---

### accept — CI gating — Integration tests are credential-gated, not required

**File:** `.github/workflows/ci.yml`, `.github/workflows/integration.yml`

**Evidence:**
- `ci.yml`: Runs `pnpm test` (excludes `e2e/integration/`) on every PR, all platforms (Ubuntu + Windows, Node 20 + 22)
- `integration.yml`: Runs `pnpm test:integration` only if `PAX8_CLIENT_ID` / `PAX8_CLIENT_SECRET` secrets are present; `continue-on-error: true` (non-blocking)
- Subprocess tests run with `PAX8_DEMO=1` in ci.yml, so no real credentials needed

**Why it matters:**
The split is intentional: forks and credential-less CI never fail due to missing secrets. Maintainers can optionally gate merges on integration tests once the suite is stable (remove `continue-on-error: true`).

**Recommended fix:**
Document in CONTRIBUTING.md that PRs don't require integration test passage, but maintainers review the integration results as an optional signal. Once wire-level write tests land (see block-launch fix), promote integration to `continue-on-error: false` for production launches.

---

### accept — Subprocess tests — Isolation and coverage instrumentation are robust

**File:** `vitest.config.ts`, `vitest.test-isolation-setup.ts`, `vitest.coverage-provider.ts`

**Evidence:**
- Thresholds set to 60% statements, 42% branches, 65% functions, 60% lines (all cleared in current run)
- Custom v8 provider merges subprocess profiles (runCli spawns the built CLI and ingests child coverage)
- Test isolation via fresh tmpdir per run (avoids local `~/.pax8/` leakage)
- `PAX8_DEMO=1` swapped in on test workers; no branch secrets in code

**Why it matters:**
Coverage thresholds are honest (subprocess tests counted) and isolated (no cross-test pollution). The custom provider is necessary because subprocess tests (the CLI itself) are the main execution path — this setup correctly attributes coverage to source files.

**Recommended fix:**
No action. Consider documenting the custom provider in CLAUDE.md for future agents.

---

## Coverage by command group

| Group | Tested | Total | Coverage | Gap |
|-------|--------|-------|----------|-----|
| auth | 3 | 4 | 75% | login + logout tested, status ✓, logout destructive |
| companies | 4 | 5 | 80% | list/show/more ✓, create/update skipped (isWrite) |
| config | 2 | 4 | 50% | show/path ✓, init/set skipped (interactive) |
| contacts | 2 | 6 | 33% | list/show ✓, create/delete/update skipped |
| cost | 1 | 1 | 100% | sim ✓ |
| orders | 2 | 3 | 67% | list/show ✓, create skipped |
| products | 3 | 3 | 100% | list/search/show ✓ |
| quotes | 2 | 8 | 25% | list/show ✓, create/update/delete/send/line-items skipped |
| subscriptions | 3 | 6 | 50% | list/show/renewals ✓, cancel/update skipped |
| invoices | 4 | 5 | 80% | list/show/items/audit ✓, dispute skipped |
| webhooks | 3 | 10 | 30% | list/show/topics ✓, create/update/enable/disable/delete/logs/test skipped |
| recommendations | 1 | 4 | 25% | list ✓, act/filter/upsell skipped |
| reports | 2 | 2 | 100% | mrr/growth ✓ |
| meta | 5 | 9 | 56% | version/doctor/dashboard/report-bug/init ✓; completions/easter-eggs uncovered |

---

## Measured coverage (pnpm test:coverage)

```
Statements   : 74.22% ( 6097/8214 )
Branches     : 59.11% ( 2892/4892 )
Functions    : 78.14% ( 1101/1409 )
Lines        : 74.44% ( 4893/6573 )
```

**By package:**

| Package | Statements | Branches | Functions | Lines |
|---------|------------|----------|-----------|-------|
| cli/src/commands | 65.09% | 52.50% | 72.35% | 66.32% |
| cli/src/lib | 85.57% | 76.29% | 87.19% | 90.25% |
| core/src/api | 82.69% | 64.78% | 64.13% | 92.28% |
| core/src/auth | 71.34% | 60.41% | 64.28% | 79.20% |
| core/src/config | 97.67% | 77.77% | 91.66% | 100.00% |
| core/src/mock | 93.91% | 80.27% | 95.65% | 96.16% |
| core/src/services | 89.88% | 74.65% | 86.02% | 93.54% |

**Commands with lowest statements coverage:**

- usage/show: 39.21%
- cost/sim: 43.40%
- invoices/dispute: 44.44%
- webhooks/show: 48.71%
- quotes/show: 50.00%

