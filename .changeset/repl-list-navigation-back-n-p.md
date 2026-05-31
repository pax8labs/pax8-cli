---
"@pax8/cli": minor
---

REPL list navigation: `back`, `n`, `p` now resume the last list session without retyping flags. Closes #456.

Pre-fix, the REPL flow `clients list` → type `26` → drill into the company → end up back at `pax8>` left the user with no way to continue browsing except retyping `clients list --page 3`. Surfaced as a daily-workflow paper-cut during partner walkthrough. Three new REPL shortcuts:

- `back` — re-runs the last list command at the same page (handy after a drill-in: the prior listing is one keystroke away).
- `n` — pages forward (next page of the last list).
- `p` — pages backward.

`clients list` is the first surface wired up. After each render in REPL mode (`PAX8_REPL=1`) the command writes `last-list-context.json` containing the argv it ran with and the resolved `{ number, totalPages }` envelope, and the REPL reads that file when `n`/`p`/`back` is typed. Argv rewriting handles both the "user typed `--page N`" case (replace) and the implicit-default case (append). Each list footer in REPL mode prints a one-line `REPL: n=next · p=prev · back=re-run` hint so the affordance is discoverable.

Boundary checks: `n` at the last page and `p` at the first page print a dim "Already on the last/first page" message and re-prompt instead of clobbering state. Missing or corrupt `last-list-context.json` triggers a clean "No recent list to navigate" message — never a spawn with garbage argv.

Shape validation on the loaded context (`loadLastListContext`) defensively rejects tampered files — a tampered or truncated context can't surface an unexpected argv. Wired through `safeWriteFileSync` so the cache file is mode `0o600` and refuses to follow symlinks (same posture as the pre-existing `last-list.json` + `pending-actions.json` writes).

This wires `clients list` only as the proof-of-pattern; the same `saveLastListContext()` call belongs on `subscriptions list`, `invoices list`, `orders list`, `quotes list`, `contacts list`, `webhooks list`, etc. — tracked separately so each rollout can be reviewed cleanly.

Helpers exposed in `lib/last-list.ts` for the rollout: `saveLastListContext`, `loadLastListContext`, `rewriteArgvForPage`, plus the `LastListContext` interface. 7 new unit tests cover round-trip, corruption, shape validation, and argv rewriting (replace + append + no-mutate).
