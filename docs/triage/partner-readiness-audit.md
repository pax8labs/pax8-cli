# Partner-readiness audit — v0.1.0

**Audit date:** 2026-05-11
**Repo state at audit time:** `main @ 830774a` (post-#381 atomic companies create, post-#379 clients rename, post-#376 recommendations OE axis)
**Last reconciled:** 2026-05-11 against main @ `1a082a8` (post-#382 docs alignment, post-#374 orders Status column drop, post-#380 integration harness cache fix, post-#373 PAX8_DEMO override)
**Method:** Six parallel dimension agents, plus a top-level synthesis. Each dimension report lives under `docs/triage/partner-readiness-audit/`.
**Scope:** Read-only audit. No code changes, no PRs, no issue filings.

> **Post-audit reconciliation note.** Four PRs from this session merged after the audit ran. The findings below are annotated with **[resolved]** where a subsequent merge closed them. The dimension reports under `partner-readiness-audit/` are point-in-time snapshots and have NOT been edited to reflect the merges — this top-level doc is the reconciled view. See the [Post-audit reconciliation](#post-audit-reconciliation) section below for the full mapping.

---

## Executive summary

**Recommendation: ship v0.1.0 after fixing 3 specific block-launch items, accepting 10 fix-before items as launch-window work, and documenting the rest as known issues.**

The CLI is in noticeably better shape than the agent-driven assembly process would suggest. The 25+ PRs that landed in the last two days settled cleanly — the vocabulary, atomic-create, clients-rename, and recommendations refactors all left consistent surfaces. The strategic/forensic pass (dimension 6) found **0 block-launch findings and 0 trust-damaging discoveries**. The CLI feels designed, not assembled.

But three concrete things would visibly break partners in the first hour:

1. **Quotes read schema mismatch** — `GET /quotes` returns a nested `client` object but the Zod schema expects flat `companyId`. Silent failure on real API; masked by demo mode. (`packages/core/src/api/types.ts:659-692`, dim 1)
2. **Timestamp field naming scatter** — `created` / `createdDate` / `createdOn` / `updatedAt` across the type system. Generic `--json` consumers must handle 5 conventions. (dim 2)
3. **Zero wire-level coverage for any write operation** — 18 write commands tested only against `MockPax8Client`. Same regression class as the #307 quotes `/v1` vs `/v2` bug that started this whole cycle. (dim 4)

Numbers 1 and 2 are concrete, scoped fixes (~half a day combined). Number 3 is an architectural gap that's worth landing one canonical write integration test before shipping (e.g., orders create) and the rest can roll into v0.1.1.

---

## Findings rolled up by severity

### Block-launch (3)

| # | Dimension | Finding | File |
|---|---|---|---|
| 1 | API conformity | Quotes API schema mismatch: spec returns nested `client`, schema expects flat `companyId` | `packages/core/src/api/types.ts:659-692`, `packages/core/src/api/quotes.ts:94-96` |
| 2 | Internal consistency | Timestamp field naming inconsistent across types (`created` / `createdDate` / `createdOn` / `updatedAt`) | `packages/core/src/api/types.ts:140,452,504,667-668,701,723` |
| 3 | Test coverage | Zero wire-level integration tests for ANY write operation (18 write commands mocked-only) | `e2e/integration/` (5 read-only files) |

### Fix-before-launch (10)

| # | Dimension | Finding | File |
|---|---|---|---|
| 4 | API conformity | Quotes `--status` filtered client-side; spec supports server-side filter | `packages/cli/src/commands/quotes/list.ts:59-64` |
| 5 | API conformity | Companies missing geo/business-rule filters (`city`, `country`, `stateOrProvince`, `selfServiceAllowed`, etc.) | `packages/core/src/api/companies.ts:19-22` |
| 6 | API conformity | Invoices missing advanced filters (`sort`, date range, balance, `status` not surfaced in CLI) | `packages/core/src/api/invoices.ts:20-27` |
| 7 | Internal consistency | ~~README + AGENTS.md still lead with `pax8 companies *` after the rename~~ **[resolved by #382]** | `README.md:84,102,105`, `AGENTS.md:78-81` |
| 8 | Internal consistency | `Company.created` is bare; all other types use camelCase timestamps | `packages/core/src/api/types.ts:140` |
| 9 | Docs accuracy | skill.md + AGENTS.md document `pax8 invoices items <invoice-id>` as a positional; command requires `--invoice-id` flag | `packages/claude-skill/skill.md:22`, `AGENTS.md:24` |
| 10 | Docs accuracy | `CLAUDE.md` missing `pax8 report growth` row in queries table (present in AGENTS.md) | `CLAUDE.md:9-24` |
| 11 | Test coverage | Branch coverage on products (0%), invoices (34%), webhooks (57%) APIs leaves error paths untested | `packages/core/src/api/products.test.ts`, `invoices.test.ts`, `webhooks.test.ts` |
| 12 | Test coverage | Easter-eggs, completions, init, report-bug have no test references | `packages/cli/src/__tests__/` |
| 13 | Strategic | Integration-test CI workflow silently skips when secrets aren't configured; no docs/checklist warns about this | `.github/workflows/integration.yml:22,49-66` |

### Fix-soon-after-launch (7)

| # | Dimension | Finding |
|---|---|---|
| 14 | API conformity | Recommendations STAX divergence disclosed in help but not in `--json` output |
| 15 | API conformity | Usage API pagination contract undocumented |
| 16 | Internal consistency | Quote `createdOn`/`expiresOn` vs Order `createdDate` divergence (intentional but undocumented) |
| 17 | Internal consistency | `mrrAtRisk` deprecation timeline invisible in help text and JSON output |
| 18 | Test coverage | Per-command e2e matrix skips 29 of 78 commands in live runs (write + interactive) |
| 19 | Surface scope | 18 internal `PAX8_*` env vars undocumented; partners could stumble on `PAX8_ALLOW_INSECURE_BASE` or `PAX8_DEBUG_RAW` |
| 20 | Strategic | **[wants-second-opinion]** Deprecation marker for `mrrAtRisk` in JSON output itself (vs. just help text + TS docstring) |

### Accept (8+)

- D1: Invoice `status` field missing from OpenAPI but schema correctly defends with `.optional()`
- D1: Subscriptions list missing optional filters (`billingTerm`, `productId`, `sort`) — partial completeness OK for v0.1.0
- D3: README.md duplicates "Credential Setup Guide" link at line 487 (cosmetic)
- D4: Mock data is fresh and schema-aligned via invariant tests
- D4: CI gating split (unit always, integration credential-gated) is intentional and correct
- D5: Deprecated `status` command alias correctly hidden
- D5: Easter-eggs (`moo`, `coffee`) intentionally hidden
- D5: `@pax8/core` exports surface is intentional and well-documented
- D5: Configuration schema is clean and Zod-validated
- D5: No half-built commands; only TODO is external (Pax8 API Idempotency-Key support)
- D6: 10+ PASS items including recovery hints, parity test, taxonomy disclosure, doctor checks, version output, demo banner, address validation, contact validation, spinner/stdout separation

---

## Coverage snapshot

| | Result |
|---|---|
| Total commands | 68 (39 reads / 29 writes) |
| Command groups | 16 |
| Hidden commands | 3 (1 deprecation alias, 2 easter eggs) |
| `PAX8_*` env vars | 24 (6 documented for partners, 18 internal) |
| Unit test coverage | 74.22% statements / 59.11% branches (thresholds: 60% / 42%) |
| Wire-level integration tests | 6 files, all read-only (companies, quotes, products, subscriptions, invoices, orders — orders added by #380) |
| Write operations without integration tests | 18 |

---

## Post-audit reconciliation

Four PRs from this session merged after the audit was written. Where they touch audit findings:

| PR | Title | Audit impact |
|---|---|---|
| #373 | `PAX8_DEMO=false` overrides `demo:true` in config | None — finding-orthogonal infra fix. Side-effect: the audit files were swept into this commit's working tree and pushed to main alongside it. |
| #374 | Orders: drop Status column; mark `--status` as documented no-op | None — no audit finding cited the Status column. |
| #380 | Integration harness cache isolation + orders v1 smoke + `--status` wire-pin test | **D4 partial:** wire-smoke test count is now 6 (added orders). The block-launch finding "zero wire-level coverage for any write operation" still stands — #380 added a read-side test, not a write. |
| #382 | Align user-facing docs to clients-rename + contacts-create canonical names | **D2 finding #7 RESOLVED.** README + AGENTS.md now lead with `pax8 clients *` per the diff. The `companies` references in user-facing demo flows are gone. |

**Findings NOT yet addressed by these merges** (verified by re-checking the source files at the post-merge HEAD):

- **D3 finding #9** — `pax8 invoices items` is still documented as a positional in `packages/claude-skill/skill.md:22` and `AGENTS.md:24`. The actual command requires `--invoice-id <id>` (silent failure if positional is supplied). #382 didn't touch these lines.
- **D3 finding #10** — `CLAUDE.md` still does not have a `pax8 report growth` row in the queries table. #382 updated other rows for `clients` but didn't add this one.
- All block-launch findings (#1 quotes schema, #2 timestamp naming, #3 no wire write coverage) remain open.
- All fix-before-launch findings except #7 remain open.

Recommendation unchanged: land the three block-launch fixes + the remaining docs items pre-launch.

---

## Per-dimension reports

Each dimension agent produced a detailed report with citations. The top-level synthesis above is intentionally compressed — go to the dimension docs for full findings, evidence quotes, and recommended-fix sketches.

- **[01 — API conformity (read surfaces)](./partner-readiness-audit/01-api-conformity-reads.md)** — 7 findings (1 block, 3 fix-before, 2 fix-soon, 2 accept). Quotes schema mismatch is the biggest.
- **[02 — Internal consistency](./partner-readiness-audit/02-internal-consistency.md)** — 5 findings (1 block, 2 fix-before, 2 fix-soon). Timestamp naming is the biggest.
- **[03 — Documentation accuracy](./partner-readiness-audit/03-docs-accuracy.md)** — 3 findings (0 block, 2 fix-before, 1 accept). `invoices items` positional vs flag is the most embarrassing.
- **[04 — Test coverage](./partner-readiness-audit/04-test-coverage.md)** — 6 findings (1 block, 2 fix-before, 1 fix-soon, 2 accept). No wire write coverage is the systemic gap.
- **[05 — Surface area and scope](./partner-readiness-audit/05-surface-scope.md)** — 7 findings (0 block, 0 fix-before, 1 fix-soon, 6 accept). Includes the full command tree appendix.
- **[06 — Strategic / forensic](./partner-readiness-audit/06-strategic-forensic.md)** — 17 findings (0 block, 7 fix-before, 9 fix-soon, 1 accept, 1 wants-second-opinion). The judgment-driven pass.

---

## The narrative

A read on where this codebase actually sits, written for a peer engineer.

**This isn't a prototype.** The CLI has 68 commands, real Zod-validated schemas, an integration test harness with a credential gate, an `@pax8/core` package with intentional exports, a config schema with sensible defaults, a doctor command that recognizes three credential paths, a deprecation alias pattern for renamed commands, and a parity test that catches drift between command-group aliases. None of those are prototype-grade.

**It also isn't yet production.** Three things stand between current state and "I'd publish this for partners on Monday":

1. **The quotes schema bug is a v0.1.0 launch-killer.** Demo mode hides it. A partner setting up real credentials and running `pax8 quotes list` is going to hit it within their first 10 minutes. The fix is small — a `.transform()` in the Zod schema or a flatten step in `QuotesApi.list()` — but it has to land before publish. The fact that it exists now, after a write-side audit, is the strongest evidence that read paths got less rigor than write paths and the audit doc structure should be updated to include reads in its scope.

2. **Timestamp naming is a "this is what an assembly job feels like" smell.** Five conventions across five types isn't a bug per type — every individual field was probably chosen for a reason (matching upstream API, matching prior internal naming). But the aggregate is a partner reading `--json` from two different commands and getting back `createdDate` from one and `createdOn` from another. That's the kind of thing they'll quietly route around rather than file an issue about, and the routing-around becomes the lasting impression. It's mechanical to fix, but it's the kind of work you'd do once and then never want to touch again, so doing it right pre-launch is the right call.

3. **Write coverage is fine for now but bad as a long-term posture.** Every write command went through demo-mode subprocess testing, which catches obvious bugs but doesn't catch the wire-level mismatches that #307 surfaced. Landing one integration test for one write path (orders create against a sandbox tenant) closes the architectural gap, even if you don't backfill all 18 writes immediately. Without that one, the read-only integration suite gives a false sense of security: it caught the quotes URL bug because it exercised the URL, but it wouldn't catch a writes-side equivalent.

**Beyond those three, the audit found surprisingly little.** The strategic/forensic pass — the one designed to find "this was hand-edited" smells — found zero block-launch issues and reported the CLI "feels designed, not assembled." Help text is honest about CLI-invented heuristics (seat_gap, opportunityType taxonomy), recovery hints point to real commands with correct flag syntax, the parity test between `clients` and `companies` actually works, the demo banner shows correctly, error paths use canonical error codes from a single source, spinner output goes to stderr while data goes to stdout. Those are all signs of someone (or, in this case, multiple agents under careful direction) caring about the surface and getting the details right.

The dimension that surprised me the least was internal consistency. The recent refactors (vocabulary #298/299, clients rename #379, atomic create #381) all landed cleanly, and the consistency agent found only loose ends — README still uses old vocabulary in two demo-flow examples, one bare `created` field on Company — not systemic drift. That's a good signal about how the agent-driven workflow has been operating: refactors are landing as actual refactors, not as partial pattern-applications that leave the codebase in a fragmented state.

**One thing the audit doesn't capture: partner expectations.** The CLI is marketed (per the README) as turning the Pax8 marketplace into computed answers — renewals, MRR, invoice audits, recommendations. Those are the features that need to work cleanly out of the box for v0.1.0 to feel valuable. The audit covers conformity and consistency, but not "is this product useful at all." That question is closer to the recommendations engine, the renewals computation, and the dashboard, and all three of those have passing tests and accurate help text per the audit. Whether they're useful in practice is a different question that requires real partner trials, not a static read.

**Net read:** This is closer to production than to prototype. Two-thirds of the way, maybe a little more. The three block-launch findings are concrete and small; they don't represent architectural debt, they represent oversights. Fix them and the v0.1.0 launch is honest. Ship as-is and partners will hit the quotes bug in the first hour and quietly decide the CLI isn't ready.

If the question is "should we ship this Monday" the answer is "fix three things and yes." If the question is "is there a deeper rot we're missing" the answer this audit gives is "no — six parallel audits across read paths, consistency, docs, tests, surface area, and judgment-driven forensic all came back with finite, scoped findings."

---

## Caveats on the audit itself

- **Scope tradeoff.** Each dimension agent had ~30-60 minutes. Coverage is broad but not exhaustive. The audit prioritized high-signal checks (does the README quick-start work, do schemas match the spec, is the parity test real) over thorough enumeration. A two-week audit would find more — most of it would probably be in the fix-soon-after-launch tier.
- **Read-only constraint.** The audit deliberately didn't fix things, and a few findings would be one-line fixes (the `invoices items` docs, the CLAUDE.md row). That's intentional — the audit's job is to surface, the fix decisions are Josh's.
- **One second-opinion item.** Whether to add a deprecation marker to `--json` output for the `mrrAtRisk` alias is a policy call (the technical work is clear). Flagged for Josh to decide rather than assumed away.
- **Dimensions might double-count.** Two agents independently flagged the README-uses-`companies` issue (dim 2 and dim 3) from slightly different angles. They agree on the finding; the synthesis lists it once. Where dimensions disagreed (e.g., dim 3 said "no stale vocabulary in agent-facing docs" while dim 2 said "README leads with companies"), the synthesis prefers the more conservative reading — the discrepancy is documented inline in dim 3.
- **What the audit didn't check:** Telemetry contract correctness, security-sensitive paths (credential storage, token handling) beyond what the doctor command verifies, performance characteristics on large portfolios, accessibility of help-text rendering on non-default terminals.

---

## Recommended action for Josh

1. **Land the three block-launch fixes.** Quotes schema (~half day), timestamps consolidation (~2 hours), one canonical write integration test (~2-4 hours).
2. **Land the docs-accuracy fix-before items.** `invoices items` flag-vs-positional in skill.md + AGENTS.md, CLAUDE.md missing row, README + AGENTS.md `companies` → `clients` swap. Maybe 30 minutes total.
3. **Decide on the wants-second-opinion item** (JSON-level deprecation marker for `mrrAtRisk`).
4. **Defer the rest.** The fix-soon-after-launch and accept items can ride in v0.1.1 with a known-issues section in the v0.1.0 release notes that points at this audit doc.
5. **Use the audit's per-dimension docs as the source of truth** if specific findings need elaboration; this top-level doc is the synthesis but the dimension reports have the evidence and citations.
