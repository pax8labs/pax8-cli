# Public OSS launch checklist

Working doc for the public OSS release of `pax8-cli`. Source plan lives in chat-transcript context as of 2026-05-29; this file is the executable checklist. Mark items off as they complete. Add issue links inline where work is tracked elsewhere.

> **Status legend:** ✅ done · 🟡 in flight · ❌ blocked · ⬜ not started · ⏭️ deferred (with owner + date)

---

## Phase 0 — Decisions to lock (blocks everything downstream)

| # | Decision | Status | Owner | Notes / link |
|---|---|---|---|---|
| 0.1 | Public repo location: `pax8labs/pax8-cli` (flip) vs. fresh `pax8-oss/pax8-cli` | ⬜ | | #141; Tier-2 approval doc §8 recommends fresh |
| 0.2 | Initial public version: continue 0.3.x vs. cut 0.3.1 as launch tag vs. 1.0.0 | ⬜ | | Recommend 0.3.x or 0.3.1 (honest about maturity) |
| 0.3 | Git history: preserve vs. squash | ⬜ | | Recommend preserve after #461/#489 scrub confirmed clean |
| 0.4 | License sign-off (Apache-2.0) | ⬜ | Legal | Confirm SPDX headers complete (#169) |
| 0.5 | DCO vs. CLA | ⬜ | | Default: keep DCO (already wired) |
| 0.6 | npm `@pax8` scope claimed + trusted-publisher registered | ⬜ | | Workflow expects this — see CONTRIBUTING.md maintainer note |
| 0.7 | GitHub Discussions enabled before flip | ⬜ | | Required to drop the hedge in SUPPORT.md |
| 0.8 | Launch comms scope: soft (internal + blog) vs. broad (corporate social + partner email) | ⬜ | Marketing/DevRel | Drives polish bar and day-of-launch load |

**Gate to Phase 1:** all eight rows ✅.

---

## Phase 1 — Code & test readiness gate

### 1.1 Clear the merge queue

| # | Task | Status | Link |
|---|---|---|---|
| 1.1.a | Triage open dependabot PRs (#558, #559, #560, #550, #551, #552) | ⬜ | |
| 1.1.b | Investigate "Claude Code Review" failure on #560 | ⬜ | |
| 1.1.c | Merge or refresh stalled `chore: release` PR #546 | ⬜ | 9 changesets stacked since 2026-05-21 |

### 1.2 Address open external issues

| # | Task | Status | Link |
|---|---|---|---|
| 1.2.a | Decide #233 (persist OAuth token to disk): fix / defer / close | ⬜ | Only open external-reviewer issue |

### 1.3 Quality matrix on a clean checkout

Run on macOS, Linux, and Windows PowerShell:

| # | Check | macOS | Linux | Windows |
|---|---|---|---|---|
| 1.3.a | `git clone` → `pnpm install` → `pnpm build` no warnings | ⬜ | ⬜ | ⬜ |
| 1.3.b | `pnpm test` all pass | ⬜ | ⬜ | ⬜ |
| 1.3.c | `pnpm test:coverage` — core ≥80%, cli ≥70% | ⬜ | ⬜ | ⬜ |
| 1.3.d | `pnpm test:integration` against **production** Pax8 API | ⬜ | ⬜ | ⬜ |
| 1.3.e | `pnpm dev` → REPL launches with intro graphics | ⬜ | ⬜ | ⬜ |
| 1.3.f | `node packages/cli/dist/index.js` → REPL launches with intro graphics | ⬜ | ⬜ | ⬜ |
| 1.3.g | `npm link` → `pax8` on PATH → every README example works | ⬜ | ⬜ | ⬜ |
| 1.3.h | `PAX8_DEMO=1 pax8 <every command>` — no errors, no UUID leaks, no `[object Object]` | ⬜ | ⬜ | ⬜ |

Reconcile test-count claim (README says 800+, CHANGELOG says 1022+; pick the actual current number).

### 1.4 Security pass

| # | Check | Status | Link |
|---|---|---|---|
| 1.4.a | `pnpm audit` — zero high/critical | ⬜ | |
| 1.4.b | CodeQL latest run on `main` — zero new findings | ⬜ | Code Scanning still disabled per #138 — enable it |
| 1.4.c | Run security-review skill on diff between v0.1.0 tag and current `main` | 🟡 | In progress this session |
| 1.4.d | Verify report-bug redactor catches all cases in `redactor.test.ts` | ⬜ | |
| 1.4.e | Scrub internal hostnames, IPs, ticket prefixes, employee names from source/tests/CHANGELOGs | ⬜ | #461/#489 close; verify still clean |
| 1.4.f | Network-egress allowlist verification (4 documented hosts, no others) | ⬜ | Run in network-namespaced container |

---

## Phase 2 — Documentation final pass

### 2.1 README accuracy

| # | Task | Status |
|---|---|---|
| 2.1.a | Remove "Pre-release" banner | ⬜ |
| 2.1.b | Promote `From npm` to recommended path; demote source install to contributor subsection | ⬜ |
| 2.1.c | Fix welcome-screen version fallback (currently hard-codes `"0.1.0"`) | ⬜ |
| 2.1.d | Replace remaining "pre-launch" prose with neutral language | ⬜ |
| 2.1.e | Update test-count claim to actual current value | ⬜ |
| 2.1.f | Re-run every code-block example in a fresh terminal; fix drift | ⬜ |

### 2.2 Cross-doc sweep

| # | Task | Status |
|---|---|---|
| 2.2.a | SUPPORT.md: remove "if Discussions isn't enabled yet" hedge | ⬜ |
| 2.2.b | AGENTS.md / CLAUDE.md: re-read for internal-system references | ⬜ |
| 2.2.c | `packages/core/README.md`: verify standalone-library example works | ⬜ |
| 2.2.d | `packages/claude-skill/skill.md`: self-contained verification | ⬜ |

### 2.3 Repo metadata

| # | Task | Status |
|---|---|---|
| 2.3.a | GitHub repo description, homepage, topics, social preview | ⬜ |
| 2.3.b | npm `package.json` repository/homepage/bugs URLs → final public repo | ⬜ |
| 2.3.c | LICENSE, CODE_OF_CONDUCT, SECURITY, CONTRIBUTING, SUPPORT present | ✅ | |
| 2.3.d | `.github/ISSUE_TEMPLATE/` + `pull_request_template.md` partner-facing | ⬜ |

### 2.4 CHANGELOG presentation

| # | Task | Status |
|---|---|---|
| 2.4.a | Per-package CHANGELOGs have partner-readable launch summary | ⬜ |
| 2.4.b | Root CHANGELOG.md points at per-package files | ✅ (done 2026-05-28) |

---

## Phase 3 — Infrastructure for the public flip

### 3.1 Repo creation / transfer

| # | Task | Status |
|---|---|---|
| 3.1.a | If fresh repo: create `pax8-oss/pax8-cli`, push `main` | ⬜ |
| 3.1.b | If flip in place: `gh repo edit pax8labs/pax8-cli --visibility public` (dry-run last) | ⬜ |
| 3.1.c | Re-seed roadmap-shaped issues on public repo (or leave on private) | ⬜ |

### 3.2 npm trusted publishing

| # | Task | Status |
|---|---|---|
| 3.2.a | Confirm OIDC trusted publisher registered for `@pax8/cli` | ⬜ |
| 3.2.b | Confirm OIDC trusted publisher registered for `@pax8/core` | ⬜ |
| 3.2.c | Dry-run release to throwaway scope OR private dist-tag | ⬜ |

### 3.3 Branch protection (public repo)

| # | Task | Status |
|---|---|---|
| 3.3.a | `main` protected, requires PR + 1 review | ⬜ |
| 3.3.b | Required checks: Integration, CodeQL, lint, typecheck | ⬜ |
| 3.3.c | Linear history enforced | ⬜ |
| 3.3.d | Release workflow allowed to push tags | ⬜ |

### 3.4 GitHub features

| # | Task | Status |
|---|---|---|
| 3.4.a | Enable Discussions | ⬜ |
| 3.4.b | Enable Security advisories | ⬜ |
| 3.4.c | Enable Code Scanning (closes #138) | ⬜ |
| 3.4.d | Confirm Dependabot config transfers to public repo | ⬜ |
| 3.4.e | CODEOWNERS aligned with public org | ⬜ |

### 3.5 npm pre-publish dress rehearsal

| # | Task | Status |
|---|---|---|
| 3.5.a | `npm pack` both packages; inspect tarballs for stowaways | ⬜ |
| 3.5.b | `files` field ships only `dist/` (+ `skill.md` for claude-skill) | ⬜ |
| 3.5.c | `bin.pax8` entrypoint executable after global install | ⬜ |

---

## Phase 4 — Cutting the release

### 4.1 Final freeze

| # | Task | Status |
|---|---|---|
| 4.1.a | 24-hour pre-launch freeze on `main` declared | ⬜ |
| 4.1.b | Phase 1.3 quality matrix re-run on the exact commit to be tagged | ⬜ |

### 4.2 Release execution (in order)

| # | Task | Status |
|---|---|---|
| 4.2.a | Merge final `chore: release` PR | ⬜ |
| 4.2.b | Confirm release workflow published `@pax8/cli` to npm with provenance | ⬜ |
| 4.2.c | Confirm release workflow published `@pax8/core` to npm with provenance | ⬜ |
| 4.2.d | `npm view @pax8/cli` and `npm view @pax8/core` show version + provenance | ⬜ |
| 4.2.e | Tag release on GitHub with partner-facing summary | ⬜ |
| 4.2.f | Flip repo visibility / push to public repo | ⬜ |
| 4.2.g | Smoke `npm install -g @pax8/cli` on fresh macOS, Linux, Windows | ⬜ |

### 4.3 Rollback plan (rehearsed before launch, not after)

| # | Task | Status |
|---|---|---|
| 4.3.a | Document `npm deprecate` path | ⬜ |
| 4.3.b | Document repo re-private procedure | ⬜ |
| 4.3.c | Document secret-leak response (rotate first, history rewrite is last resort) | ⬜ |

---

## Phase 5 — Launch communications

### 5.1 Day-of artifacts

| # | Task | Status |
|---|---|---|
| 5.1.a | GitHub release notes (partner-facing top + full CHANGELOG link) | ⬜ |
| 5.1.b | README hero — pre-release banner removed, "Get started in 60s" callout | ⬜ |
| 5.1.c | Internal Slack announce post | ⬜ |
| 5.1.d | External announce (scope per Phase 0.8) | ⬜ |
| 5.1.e | DevRel coordination — `devx.pax8.com` updates timed with launch | ⬜ |
| 5.1.f | Partner-portal mention (if appropriate) | ⬜ |

### 5.2 Onboarding the first 100 users

| # | Task | Status |
|---|---|---|
| 5.2.a | Pin a "What this is / how to install / where to file bugs" Discussion | ⬜ |
| 5.2.b | Maintainer triage rotation for first 2 weeks | ⬜ |

---

## Phase 6 — Post-launch operations (first 2 weeks)

### 6.1 Triage cadence

| # | Task | Status |
|---|---|---|
| 6.1.a | Daily issue/PR/Discussions check (first 7 days) | ⬜ |
| 6.1.b | Confirm `api-watch` workflow routing pages someone post-launch | ⬜ |
| 6.1.c | PostHog telemetry shows `command_executed` events flowing | ⬜ |
| 6.1.d | Internal dashboard for engagement metrics | ⬜ |

### 6.2 First patch release

| # | Task | Status |
|---|---|---|
| 6.2.a | Plan a 0.3.x+1 patch release within 7-14 days of launch | ⬜ |

### 6.3 Roadmap visibility

| # | Task | Status |
|---|---|---|
| 6.3.a | Open-source the `enhancement`-labelled v0.2 / awaiting-pax8-api issues | ⬜ |
| 6.3.b | File a "Roadmap" Discussion post | ⬜ |

---

## Cross-cutting risk register

| Risk | Severity | Mitigation | Status |
|---|---|---|---|
| Internal references leak through to public repo | High | Phase 1.4.e scrub | ⬜ |
| First-install path broken on Windows | Medium | Phase 1.3 includes Windows | ⬜ |
| Real production tenants hit edge cases the demo fixture never exercised | Medium | `PAX8_DEMO_SCALE=large` + `api-watch` + oncall capacity | ⬜ |
| `@pax8` npm scope squatted before launch | High | Claim scope before any public mention | ⬜ |
| First-impression confusion: CLI vs. agent/MCP framing | Low | README ordering preserved through any marketing rewrite | ⬜ |
| Telemetry FUD ("they're tracking me") | Low | Opt-in by default; documented prominently | ⬜ |

---

## Working notes (append-only)

- 2026-05-29: Plan drafted in chat. Repo state captured: private at `pax8labs/pax8-cli`, never published to npm, internal version 0.3.0, 9 unreleased changesets, 6 open dependabot PRs, 1 open external issue (#233).
- 2026-05-30: Checklist file created. Security review of post-#514 changes in progress.
