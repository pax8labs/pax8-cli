---
"@pax8/cli": minor
---

Roll out pickable drill-in across `subscriptions list`, `orders list`, `invoices list`, and `quotes list`. Type a row number at the REPL prompt to drill into that row's detail view — same pattern `clients list` and `recommendations list` already shipped. Closes #418.

Each command now:
- Numbers rows in a leading `#` column (continues across pages — page 2 starts at 26).
- Persists the index → resource ID map to `~/.pax8/last-list.json` so `subscriptions show 3` resolves the same way `clients show 3` already does.
- Writes `~/.pax8/pending-actions.json` keyed by row number so the REPL's bare-number-input branch dispatches `<resource> show <id>` for the picked row.
- Renders the `promptNextSteps` inline pick prompt below the table (no-op outside a TTY, so subprocess / agent invocations see nothing on stderr).

Extracted the wiring into `lib/list-drill-in.ts:wireListDrillIn()` so the four commands become a single call instead of 30 lines of copy-paste each. The helper handles all three caches + the prompt; the caller supplies the rows, resource name, page-offset, and a label resolver function. Existing `clients list` left alone for this PR (its drill-in path is intertwined with the `--coverage` analysis branch and warrants a separate scoped refactor).

Quotes additionally renames its previous static `Try next:` block to a one-liner `Or: pax8 quotes show <id>` advisory so the pickable prompt becomes the primary affordance.
