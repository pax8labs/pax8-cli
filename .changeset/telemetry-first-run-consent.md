---
"@pax8/core": minor
"@pax8/cli": minor
---

Ask once, on the first interactive run, whether to share anonymous usage telemetry (`[Y/n]`, Enter means yes). The answer is saved as `telemetry.asked` and never re-asked; nothing is sent before an answer. Non-interactive runs are never prompted (non-TTY stdin/stderr, `CI`, `--json`, `--quiet`, `--yes` / `PAX8_YES=1`, REPL children, `pax8 telemetry` itself), so agents and pipelines stay off unless `pax8 telemetry enable` is run. `DO_NOT_TRACK=1` and `PAX8_TELEMETRY_DISABLED=1` still win.

Telemetry is no longer sent from the project's own test suite (`VITEST` / `NODE_ENV=test`), which had been the bulk of recorded events.

`@pax8/core`: new `Telemetry.needsConsent()` / `recordConsent()`; the config schema gains `telemetry.asked`.
