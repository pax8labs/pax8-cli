---
"@pax8/cli": patch
---

Normalize "Try next" pickable-step labels across the CLI:

- `pax8 subscriptions renewals` previously rendered bare `subscriptions show <id>` and `clients more "<name>"` labels — no `pax8` prefix, no `replCmd()` wrap. Now matches every other command's pattern.
- `pax8 quotes show` and `pax8 quotes send` drilled into the client by UUID; they now prefer the human-readable `quote.clientName` (flattened from the v2 quoting API's `client.name`) with the UUID as a fallback for shadow companies or older payloads. Matches the established `orders/show.ts` / `contacts/list.ts` pattern.

Cosmetic / label-only. Action arrays are unchanged, so REPL behavior is identical.

Closes #481, #482.
