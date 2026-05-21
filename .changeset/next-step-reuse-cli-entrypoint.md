---
"@pax8/cli": patch
---

`promptNextSteps()` now reuses the active CLI entrypoint when drilling into a numbered option, matching the REPL's behavior. Closes #457.

Pre-fix, the inline numeric-pick prompt rendered by `clients list`, `subscriptions renewals`, `contacts list`, `usage list`, and several others called `spawn("pax8", ...)` — which silently no-ops or fails when the CLI is launched via `node packages/cli/dist/index.js`, a yarn `-g` install in a non-standard prefix, or a linked local binary that isn't on `$PATH`. The REPL itself had the right pattern via `resolveCliPath(process.argv[1])` (see `lib/repl.ts`); this aligns the drill-in path with that.

Implementation: `lib/next-step.ts` now imports `resolveCliPath` from `lib/repl.ts` and spawns `node <cliPath> <args>` instead of `pax8 <args>`. A best-effort fallback to the legacy `spawn("pax8", ...)` shape is kept for the edge case where `process.argv[1]` is empty (e.g. a future embedded caller in an MCP wrapper).
