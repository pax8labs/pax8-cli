---
"@pax8/cli": patch
---

Normalize env-flag parsing in the update-check suppression matrix.

Two shared helpers — `truthyEnv` and `presenceEnv` — split parsing along the convention each flag follows:

- **Truthy semantics** (`"1"` / `"true"` / `"yes"` / `"on"`, case-insensitive, trimmed) apply to Pax8-owned `=1`-shape flags and to `DO_NOT_TRACK` (spec'd as `"1"` / `"0"`): `PAX8_NO_UPDATE_CHECK`, `PAX8_DEMO`, `PAX8_QUIET`, `PAX8_UPDATE_CHECK_TEST_FORCE`, `DO_NOT_TRACK`.
- **Presence semantics** (any non-empty, non-whitespace value) apply to community-convention flags whose canonical shape is presence-based: `NO_UPDATE_NOTIFIER` (matches the upstream `update-notifier` package), `CI` (matches the broad set of CI providers that set `CI` to platform identifiers rather than tokens).

Net effect for operators: setting `PAX8_DEMO=true` / `PAX8_QUIET=yes` / etc. now suppresses the update-check correctly (previously required exactly `=1`). Established conventions for `NO_UPDATE_NOTIFIER` and `CI` are preserved unchanged.
