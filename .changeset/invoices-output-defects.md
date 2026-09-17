---
"@pax8/cli": patch
---

fix(cli): stop printing next-step headers with nothing under them, and fix two `invoices dispute` output defects (#731, #733, #730)

**Every piped run of 18 commands ended on an empty section header.** `promptNextSteps()` returns early when stdin is not a TTY, but each caller wrote its `Try next:` header to stderr immediately *before* calling it — so any non-interactive invocation printed a header introducing suggestions that never arrived. #731 reported it for `invoices audit`; it was `subscriptions renewals`, `invoices show`, `cost sim`, `clients more`, `quotes *`, `contacts *`, `orders show`, `products search` and more. The header now lives inside the helper, after its early returns, so it cannot outlive its list. Commands that write their suggestion lines directly rather than through the helper were never affected.

The interactive dispute menu also repeated the company and product after the command, which are already on the numbered discrepancy line directly above it — that repetition is what overran terminal width.

**`invoices dispute` rendered a command that does not exist.** Its closing hint spliced the command and its description with a single space, unlike every other next-step line in the CLI, producing `pax8 invoices audit re-audit later to confirm resolution`. The line above it had the mirror problem — prose rendered in cyan, the runnable-command colour — so an instruction to paste into the Pax8 portal read as something to execute.

**A failed discrepancy lookup never said which data source it searched.** Discrepancy IDs are derived from the data that produced them, so an ID minted under demo mode can never match in live. The old error called that staleness and sent the user to re-run an audit that would keep minting IDs from the same source. It now names the active mode, explains why an ID from the other mode cannot match, and gives the mode-specific recovery step.
