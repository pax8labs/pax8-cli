# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-06

Initial public release.

### Added

- **Seven core workflows** computed locally from raw Pax8 data: `status`, `companies list --coverage`, `subscriptions renewals`, `invoices audit`, `recommendations list`, `recommendations act`, and `report mrr` / `report growth`.
- **Closed-loop ordering** — `recommendations act` walks portfolio gaps and places the orders interactively; `invoices audit → invoices dispute` files billing disputes against detected discrepancies.
- **`@pax8/core` standalone SDK** — all renewal, audit, recommendation, and analytics logic exposed as an importable library with zero CLI dependencies, suitable for embedding in portals, Lambdas, or partner tooling.
- **`@pax8/claude-skill`** — agent skill that wraps the CLI as AI tools for Claude Code, Cursor, Copilot, and any framework that can run shell commands; ships with a read-only vs. write safety contract.
- **Demo mode** (`PAX8_DEMO=1`) — every command runs against an in-memory fixture, so partners can evaluate the tool with no credentials and CI runs end-to-end against the same surface.
- **OAuth 2.0 client-credentials flow** — secure local credential storage at `~/.pax8/credentials.json` with mode `0600`, tokens cached in memory only and never persisted, automatic refresh at 23h.
- **Structured `--json` output with `nextActions`** — `status`, `report mrr/growth`, and `invoices audit` always include contextual next-step hints; list commands opt in via `--with-actions` to ride a `{ data, nextActions }` envelope alongside the flat JSON array (#97).
- **Idempotency keys on write commands** — `--idempotency-key <uuid>` is accepted on every mutation command (#91).
- **Machine-readable error codes** — every `CliError` carries a stable `code` (one of the `ERROR_*` constants from `@pax8/core`) so agents and scripts can branch on outcome without parsing strings (#90).
- **Output formats** — `--json`, `--csv`, `--quiet`, plus `--with-actions` (envelope mode) and `--ids-only` (one ID per line, for piping into the next command's `--company` filter).
- **Cost simulator (`pax8 cost sim`)** — model SKU swaps, quantity changes, and add-product scenarios with monthly/annual MRR delta, before actually placing the order. Pure compute over pricing data; `simulateCostChange()` is also exported from `@pax8/core` for embedders (#3).
- **Vitest test suite** — ~840 tests across unit, CLI integration (subprocess), and e2e flows, runnable end-to-end under `PAX8_DEMO=1`.
- `pax8 auth login` now masks the client secret in interactive mode (no more plaintext echo).

[0.1.0]: https://github.com/pax8labs/pax8-cli/releases/tag/v0.1.0
