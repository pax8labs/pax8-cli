# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Internal

- Scheduled API-drift watcher (`.github/workflows/api-watch.yml`) opens maintainer issues when `ERROR_API_VALIDATION` spikes are detected in telemetry. First layer of the api-resilience plan tracked at #176.

## [0.1.0] — 2026-05-06

Initial public release.

### Added

- **Seven core workflows** computed locally from raw Pax8 data: `status`, `companies list --coverage`, `subscriptions renewals`, `invoices audit`, `recommendations list`, `recommendations act`, and `report mrr` / `report growth`.
- **Closed-loop ordering** — `recommendations act` walks portfolio gaps and places the orders interactively; `invoices audit → invoices dispute` files billing disputes against detected discrepancies.
- **`@pax8/core` standalone SDK** — all renewal, audit, recommendation, and analytics logic exposed as an importable library with zero CLI dependencies, suitable for embedding in portals, Lambdas, or partner tooling.
- **`@pax8/claude-skill`** — agent skill that wraps the CLI as AI tools for Claude Code, Cursor, Copilot, and any framework that can run shell commands; ships with a read-only vs. write safety contract (#136).
- **`pax8 cost sim`** — model SKU swaps, quantity changes, and add-product scenarios with monthly/annual estimated MRR delta, before actually placing the order. Pure compute over pricing data; `simulateCostChange()` is also exported from `@pax8/core` for embedders (#163).
- **`pax8 report-bug`** — opens a sanitized, prefilled GitHub issue from the most recent failure. Strips UUIDs, emails, `$HOME` paths, JWTs, and long token-shaped strings; uses `gh` if available, otherwise a prefilled URL via the platform open command. Nothing leaves the machine without explicit `[y/N]` confirmation (#161).
- **Demo mode** (`PAX8_DEMO=1`) — every command runs against an in-memory fixture, so partners can evaluate the tool with no credentials and CI runs end-to-end against the same surface.
- **OAuth 2.0 client-credentials flow** — secure local credential storage at `~/.pax8/credentials.json` with mode `0600`, tokens cached in memory only and never persisted, automatic refresh at 23h.
- **Structured `--json` output with `nextActions`** — `status`, `report mrr/growth`, and `invoices audit` always include contextual next-step hints; list commands opt in via `--with-actions` to ride a `{ data, nextActions }` envelope alongside the flat JSON array (#97).
- **Idempotency keys on write commands** — `--idempotency-key <uuid>` is accepted on every mutation command (#91).
- **Machine-readable error codes** — every `CliError` carries a stable `code` (one of the `ERROR_*` constants from `@pax8/core`) so agents and scripts can branch on outcome without parsing strings (#90).
- **Output formats** — `--json`, `--csv`, `--quiet`, plus `--with-actions` (envelope mode) and `--ids-only` (one ID per line, for piping into the next command's `--company` filter).
- **`PAX8_API_BASE` env var** — point the CLI at sandbox / staging environments without rebuilding (#135).
- **`AGENTS.md`** at repo root — cross-runtime agent entry point (Cursor, aider, OpenCode, etc.) (#165).
- **`pax8 auth login` masks the client secret** in interactive mode — introduces the `prompts` library for secure input; no more plaintext echo (#160).
- Comprehensive test suite (1022+ tests across unit, CLI integration, and e2e flows; see CI for current count).

### Changed

- List commands return a flat array by default; `--with-actions` opts in to the `{ data, nextActions }` envelope. Breaking shape change relative to early prototypes.
- Display labels rebranded from "MRR" to "estimated MRR" to reflect that the value is computed locally and not the partner's actual billed revenue. Command paths (`pax8 report mrr`), JSON output keys (`mrr`, `mrrUplift`, etc.), and telemetry properties unchanged (#168).
- `pax8 recommendations act` now shows a multi-select picker for batch ordering instead of a one-at-a-time `y/s/q` walk; `-y` / `--yes` bypass unchanged (#167).

### Fixed

- **Telemetry — failed commands now emit events.** `handleCommandError` previously called `process.exit(1)` before the `parseAsync.catch` failure-track block could run; failure events now fire (and flush) synchronously inside the error handler. Commander parse errors route through the same path via `exitOverride()` (#145).
- **Telemetry — no more double-fire on write commands.** `recommendations act` and `orders create` were emitting two `command_executed` events per invocation (#146).
- **Telemetry — `error_code` aligned with the canonical `ERROR_*` vocabulary** from `@pax8/core` so dashboards can group by stable codes (#147).
- **Telemetry — orphaned `company_count` and `rec_count` fields** removed from the schema; they were documented but never actually emitted (#148/#149).
- **Telemetry test storage** isolated per test to eliminate full-suite flake (#118/#128).
- **`pax8 report-bug`** now redacts positional argument values (e.g. customer / company / product names typed at the CLI) from both the `command` and `Message` fields of the persisted error envelope and the submitted report. The command *structure* is preserved (`companies show <REDACTED:ARG>`) but the user-supplied value is replaced everywhere, including inside interpolated error messages like `Company not found: "<name>"` (#170/#171).

### Internal

- **Subprocess coverage instrumentation + CI-enforced threshold gate** so `vitest --coverage` reflects code paths exercised by the CLI integration tests (#150).
- **Test gap fill: +93 unit tests in `cli/lib`** plus `PAX8_API_BASE` coverage (#151).
- **Apache-2.0 SPDX headers** on every source file across the workspace (#169).
- **Release workflow with changesets + npm OIDC trusted publishing** (#133).
- **Lint clean + CI Lint step** added (#117/#130).
- **`tsc --noEmit` clean + CI Typecheck step** restored (#93/#131).
- **Governance cleanup** — co-owner added; legacy ESLint config removed (#132).
- **Test isolation** — `config.test.ts` now uses an isolated `mkdtemp` config dir per test (closes #172).
- Documentation revisions: `CLAUDE.md` excellence + cross-doc consistency (#143); README / SECURITY / CONTRIBUTING polish for v0.1.0 (#134); v0.1.0 CHANGELOG cut (#137).

[0.1.0]: https://github.com/pax8labs/pax8-cli/releases/tag/v0.1.0
