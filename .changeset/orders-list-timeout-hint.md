---
"@pax8/core": patch
"@pax8/cli": patch
---

Surface an actionable hint when `pax8 orders list` (or any command) hits the 30s default HTTP timeout, and make the timeout configurable via `PAX8_TIMEOUT_MS` (#199).

Before: the AbortController-driven timeout threw an `ApiError(status=0, "Request timed out after 30000ms")` that classified as `ERROR_INTERNAL` and rendered as a bare millisecond count. Partners with large portfolios who hit slow `/orders` responses had no signal as to what to try next.

After:
- `ERROR_API_TIMEOUT` now covers both server-side 408s and client-side AbortController timeouts. The CLI's `--json` error envelope always carries the code; the human-facing render carries recovery steps.
- The generic recovery hint suggests retrying, extending the per-request timeout via `PAX8_TIMEOUT_MS=<ms>` (capped at 300000), and running `pax8 doctor`.
- `pax8 orders list` adds a command-specific layer on top: try a smaller `--size`, narrow with `--company <name>`. The generic env-var escape hatch is concatenated as the floor so it's never crowded out.
- `PAX8_TIMEOUT_MS` is wired through `getDefaultTimeout()` and applied to every `Pax8Client` request when no explicit `timeout` option is passed. The default (30000ms) and retry behavior are unchanged.
- New exports from `@pax8/core`: `getDefaultTimeout`, `isApiTimeoutError` — the canonical predicate the CLI's error layer uses to route abort-path timeouts to `ERROR_API_TIMEOUT`. Embedders that want the same hint UX can reuse the predicate.
