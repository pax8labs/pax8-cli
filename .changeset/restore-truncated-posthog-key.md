---
"@pax8/core": patch
---

Restore the full PostHog project token (was truncated, dropping telemetry events).

The `POSTHOG_API_KEY` constant in `packages/core/src/telemetry/telemetry.ts` shipped with 32 characters of the project token instead of the full 47. PostHog's ingest API silently rejects malformed tokens, so opt-in telemetry has been a no-op since the first publish — `pax8 telemetry on` users have been sending events into a void. Restored the full value so events land correctly going forward.

This is the write-only, public-by-design project token (Sentry-DSN class — see the comment block in the source); not a server credential, safe to commit. Confirmed by inspecting the project at https://us.i.posthog.com.

No code or schema changes; only the literal string is corrected.
