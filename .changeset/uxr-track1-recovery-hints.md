---
"@pax8/cli": patch
---

Two small human-surface fixes drawn from the 2026-07-02 UXR readout (#661).

**`recommendations list` hidden-count footer now surfaces the recovery command.** UXR F6 (#652): the `N more recommendations hidden — no orderable products in catalog yet` footer had no follow-up, so partners tried `--help`, guessed, and gave up. It now appends `· run with --include-all to see them`, matching the phrasing the empty-state branch already used.

**`products search` next-step picker labels use product names instead of UUIDs.** UXR F7 (#653): the table columns didn't expose product IDs, but the "Try next" line still said `pax8 products show <ID>`. The picker now numbers the top 5 matches by product name — the underlying `products show <id>` spawn is still id-based, but the human surface never shows a UUID. `--json` output is unchanged.

Closes #652 and #653.
