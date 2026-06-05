---
"@pax8/core": patch
---

Fix PostHog telemetry: restore the truncated write-token and tag events with `app: "pax8-cli"` for the shared portfolio project.

Two related fixes, neither user-visible:

- **Token truncation.** The `POSTHOG_API_KEY` constant shipped with 32 characters of the project token instead of the full 47. PostHog's ingest API silently rejects malformed tokens, so opt-in telemetry has been a no-op since the first publish. Restored to the full value. This is the write-only, public-by-design project token (Sentry-DSN class — safe to commit).
- **Portfolio tag.** The PostHog project is shared with `pax8-cta`. Every event from this CLI now carries `app: "pax8-cli"` so dashboards can filter or pivot by source. Stability gate: renaming this string in the source breaks every saved insight or alert filtering on it. A source-shape test pins both the token format and the app name to catch regressions at unit-test time.

No behavior changes for users; backfills the observability that's been silently missing since 0.1.x.
