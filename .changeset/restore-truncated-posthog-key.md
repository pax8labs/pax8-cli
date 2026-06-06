---
"@pax8/cli": patch
"@pax8/core": patch
---

Fix PostHog telemetry: restore the truncated write-token, tag events with `app: "pax8-cli"`, and actually emit failure events.

Three related fixes — none user-visible, all restoring observability that's been silently missing since 0.1.x:

- **Token truncation.** The `POSTHOG_API_KEY` constant shipped with 32 characters of the project token instead of the full 47. PostHog's ingest API silently rejects malformed tokens, so opt-in telemetry has been a no-op since the first publish. Restored to the full value. This is the write-only, public-by-design project token (Sentry-DSN class — safe to commit).
- **Portfolio tag.** The PostHog project is shared with `pax8-cta`. Every event from this CLI now carries `app: "pax8-cli"` so dashboards can filter or pivot by source.
- **Failure events.** Commander's `postAction` hook only fires on success. The CHANGELOG entry for #145 claimed failure events were emitted, but inspection showed nothing fired for action-throws. `handleCommandError` now emits `command_executed { success: false }` with the active command's metadata (stashed by preAction in `telemetry-context`) and a derived `Pax8ErrorCode`. Action errors caught by command handlers — the bulk of the failure surface — are now visible on the dashboard.

Known remaining gap: Commander's own parse errors (unknown-command, missing required arg) short-circuit via `process.exit()` before `parseAsync.catch` can run, so those still aren't tracked. Tracked separately.

Adds three regression test surfaces:
- Source-shape guard for `POSTHOG_API_KEY` (47-char public-token format) and `APP_NAME` (literal `"pax8-cli"`).
- Subprocess test that runs a failing command and asserts the JSONL backup contains a `success: false` event with the right `command`, `subcommand`, and `error_code`.
- Unit tests for the new `setActiveCommand` / `consumeActiveCommand` helpers in `telemetry-context`.
