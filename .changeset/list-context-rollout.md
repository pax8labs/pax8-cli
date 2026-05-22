---
"@pax8/cli": patch
---

Extend the REPL `back` / `n` / `p` list navigation from #456 across the rest of the list command surface. `subscriptions list`, `orders list`, `invoices list`, and `quotes list` now all save the `last-list-context.json` snapshot after each render and surface the `REPL: n=next · p=prev · back=re-run` footer hint when running under `PAX8_REPL=1`. Closes the rollout slice of #456 that #549 explicitly deferred.

Implementation extracts the `if (process.env.PAX8_REPL === "1") { ... }` block from `companies/list.ts` into a shared `renderReplNavHint(pageEnvelope)` helper in `lib/output.ts` so each command is a one-line addition rather than a copy-paste of the hint rendering. The context-save block stays inline (a few lines per command, with the same `back`/`n`/`p` re-entry guard the original #549 code used).

No behavior change outside the REPL — `PAX8_REPL` env var gates both the hint and the context save's affordance. Full suite green: 2135 passing.
