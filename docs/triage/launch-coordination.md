# Launch coordination — pax8-cli v0.1.0

**Last updated:** 2026-05-12
**Purpose:** Single working tracker for human-facing items gating v0.1.0 publish. Engineering items live in the per-issue queue; this doc covers everything else.

---

## 1 — Engineering state

The repo went through two audit cycles in the last 48 hours:

1. **Partner-readiness audit** (six dimensions in parallel) — reports at `docs/triage/partner-readiness-audit.md` (top-level synthesis) and `docs/triage/partner-readiness-audit/01-*.md` through `06-*.md` (per-dimension). Surfaced 3 block-launch and 10 fix-before-launch findings.
2. **Partner-perspective walkthrough** — report at `docs/triage/partner-walkthrough.md`. Surfaced 3 additional UX-polish items plus verified that one earlier finding ("spinners leak into `--json`") was a false alarm.

**Landed since the audits ran** (10 PRs, all merged to main):

| PR | What |
|---|---|
| #406 | Block-launch B1 — quotes Zod schema flattens nested `client` to flat `companyId` |
| #407 | Block-launch B2 — timestamp standardization (`createdAt` / `updatedAt` / `expiresAt`) with dual-emit aliases |
| #413 | Hotfix — demo-data interfaces updated to match the canonical names; resolved `tsc --noEmit` regression introduced by #407 |
| #411 | Group D walkthrough — README documents `2>/dev/null` pattern for clean JSON pipes |
| #412 | Group A walkthrough — enum validation on 11 flag/command pairs + fuzzy product name resolution with "Did you mean" suggestions |
| #414 | Group C walkthrough — `JSON output:` sections in `--help` on 7 commands + README STAX taxonomy divergence subsection |
| #415 | Group B walkthrough — TTY empty-state messages on 9 list commands + commitment-aware cancel preview |
| #404 | Walkthrough docs cleanup — `pax8 invoices items` flag syntax + missing CLAUDE.md row + duplicate README ref |
| #405 | Filter expansion — server-side `--status` filter on quotes, plus geography/capability filters on companies, plus advanced filters on invoices |
| #383 | Audit reconciliation doc |

**In flight (open PRs):** none from the launch pile. One `chore: release` PR (#377) is open with all the merged changesets staged for v0.1.0 release-prep — that's the cut-the-release vehicle when ready.

**Block-launch state:**

- ✅ B1 #384 — closed
- ✅ B2 #385 — closed (+ #413 hotfix)
- ⏸ **B3 #386** — wire-level write tests. **Blocked: sandbox credentials are NOT configured in repo secrets** (verified: `gh api /repos/pax8labs/pax8-cli/actions/secrets` returned empty). Cannot be implemented in CI until secrets are provisioned.

**Deferred to v0.1.1 (intentional):**

- #393 — branch coverage on products/invoices/webhooks APIs (test-only, not partner-visible)
- #395 — subprocess tests for easter-eggs / completions / init / report-bug (test-only)
- #394 — CI sandbox credentials docs (companion to #386; only meaningful once secrets are provisioned)
- #397, #398, #400, #401 — non-blocking docs and filter polish

**Decisions recorded:**

- #403 — JSON deprecation marker → declined; help-text + release notes + `@deprecated` JSDoc are sufficient. Revisit only with partner-friction evidence.

---

## 2 — Open coordination items

Status legend: `not started` · `in flight` · `blocked` · `complete`

| Item | Owner | Status | Next action | Blocking on |
|---|---|---|---|---|
| **Public repo / org name decision** (#141 sweep depends on this) | Cassie | not started, no known prior activity | Schedule Cassie conversation; pick a name; create org if needed | Cassie's input |
| **Sandbox credential provisioning for CI** (PAX8_CLIENT_ID / PAX8_CLIENT_SECRET) | TBD (likely Mufaddal's team or broader API team) | not started | Identify owner; request a dedicated CI sandbox account or service-principal | Owner identification |
| **LICENSE legal sign-off** | Courtney Norton | not started, no known prior activity | Send the LICENSE file (Apache-2.0 currently in repo) for legal review; document approval | Outreach to Courtney |
| **npm OIDC trusted publisher configuration** | self | blocked | Configure the trusted publisher in npm registry once the GitHub org and repo are public and known | Public org name + public repo creation |
| **Public repo creation** | self | blocked | Create the public repo on the chosen org once the name is decided | Public org name decision |
| **Second peer reviewer beyond Cassie** | self | not started | Identify a second engineer with bandwidth for OSS-style code review on the surface; brief them | Owner identification |
| **Review page refresh on Confluence** | self | in flight (draft text exists, not yet posted) | Post the refreshed review page reflecting all post-audit landings; date it 2026-05-12+ | None — ready to post |
| **Four consolidated reviewer replies** (Tanner Horsey, Fred Lintz, Franco Aurieme, Josh Hollander) | self | not started | Draft per-reviewer reply summarizing what landed in response to each reviewer's feedback; send as Confluence inline replies or DMs | Drafting |
| **Beyond keynote framing conversation with Libby** | self | not started, no known prior activity | Schedule conversation; align on how the CLI fits the Beyond keynote narrative | Outreach to Libby |
| **Mufaddal GTM placement working session** (devx.pax8.com canonical home, Integrations Hub, integration guides) | self | not started | Schedule session; agree on where the CLI lives in Pax8 partner-facing surfaces | Outreach to Mufaddal |
| **Substantive engagement asks for unengaged reviewers** (Randall Ellis on Recommendations, Bret Pittenger on Reporting, others as relevant) | self | not started — DM drafts exist from earlier in cycle, never sent | Decide whether to send (see section 4) | See section 4 — trade-off |

---

## 3 — Sequencing

**Independent (start anytime, no upstream blockers):**

- Review page refresh on Confluence (draft text exists)
- Four consolidated reviewer replies (drafting only)
- Beyond keynote conversation with Libby (scheduling only)
- LICENSE legal sign-off with Courtney Norton (send file for review)
- Identify second peer reviewer

**Depends on public org/repo name decision:**

- Public repo creation
- npm OIDC trusted publisher configuration (needs public repo to exist)
- #141 sweep of internal URL references (replace placeholders with the final canonical URL)

**Depends on sandbox credentials being provisioned:**

- B3 #386 — wire-level write integration tests
- #394 — CI secrets documentation gains real "this is what's configured" content
- Possibly: promote `integration.yml` from `continue-on-error: true` to required

**Depends on reviewer responses:**

- The four consolidated replies are drafted before responses are needed; sending them is independent. But any reviewer who responds with new findings triggers a fresh engineering cycle that could re-open block-launch state.

**Depends on Mufaddal placement decision:**

- Whether `pax8-cli` is GA via `npm install -g @pax8/cli` only, or also surfaced on devx.pax8.com / Integrations Hub at launch, or staged.

**Final launch chain (close-out sequence once everything else is resolved):**

1. B3 #386 wire-write tests land (requires credentials)
2. `chore: release` PR #377 is updated and merged → bumps version
3. npm publish (via OIDC trusted publisher)
4. Public repo flipped from private to public
5. Internal URL sweep (#141) confirmed clean against the public URL
6. Release announcement (Confluence, partner email, Beyond keynote alignment)

---

## 4 — Auto-approval risk

**May 15, 2026 is the auto-approval deadline** on the Pax8 CLI Domain Review Confluence page. Five reviewers have not engaged substantively against the current state of the page:

- **Jen Bosier** — domain not stated in this thread
- **Chris Weiss** — Orders (explicit outreach issue exists: #369, no response yet)
- **Angelo Echtermeijer** — domain not stated in this thread
- **Randall Ellis** — Recommendations
- **Bret Pittenger** — Reporting

Auto-approval is the procedural fallback. It represents real residual risk: if any of the five surfaces a substantive finding post-publish, the response options narrow (the CLI is already in partners' hands; a post-publish bug is more expensive to fix than a pre-publish one).

### Trade-off

**Send substantive outreach DMs** (sharper than the page; drafts exist from earlier in cycle but were never sent):
- Pro: invites engagement that might surface findings before publish, when they're cheap to fix
- Con: invites engagement that might surface findings before publish, slowing the launch window if a finding is substantial

**Don't send; accept May 15 auto-approval as quiet sign-off:**
- Pro: launch window stays tight; reviewers who haven't engaged are unlikely to engage even with a DM nudge
- Con: any post-publish finding from these reviewers becomes a partner-visible issue

This is a judgment call about how much pre-launch optionality to preserve vs. how much risk to push past the publish date. No recommendation. Decision point listed in section 5.

---

## 5 — Open questions (decisions pending)

- **decision pending** — Whether to send substantive outreach DMs to the five unengaged reviewers (Jen Bosier, Chris Weiss, Angelo Echtermeijer, Randall Ellis, Bret Pittenger), or rely on May 15 auto-approval as quiet sign-off. See section 4 for trade-off.
- **decision pending** — What public repo name to use. Drives the org name decision, the public-repo-creation step, the npm OIDC configuration, and the #141 sweep. Cassie conversation is the input.
- **decision pending** — Whether the four reviewer replies (Tanner / Fred / Franco / Hollander) go out before or after the review page refresh. Order affects whether reviewers see "here's the page, here's the reply" or "here's the reply, by the way the page is also updated."
- **decision pending** — Whether to gate v0.1.0 publish on the Mufaddal GTM placement session, or publish first and integrate placement after. Affects whether v0.1.0 ships as a CLI partners discover via `npm install`, or as a CLI Pax8 announces with a GTM motion.

---

## Inventory of cross-referenced sources

- Partner-readiness audit (six dimensions): `docs/triage/partner-readiness-audit.md` and `docs/triage/partner-readiness-audit/01-*.md` through `06-*.md`
- Partner walkthrough: `docs/triage/partner-walkthrough.md`
- Engineering issue queue: GitHub issues labeled `pre-publish-write-fix` (now empty except #386), `v0.1.1`, and `decision-recorded`
- The chore release vehicle: PR #377
- Internal-URL sweep work: issue #141
