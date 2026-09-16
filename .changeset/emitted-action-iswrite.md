---
"@pax8/cli": patch
---

feat(actions): every suggested action carries a spawn-safe argv and an `isWrite` flag (#708)

Several commands suggest what to do next — `nextActions[]` on list and summary commands, `items[].action` on `today`, `orderArgs` on `recommendations list`. Two properties of those payloads were inconsistent, and both matter for agent runtimes.

**`args` was missing on several surfaces.** `command` is a display string that interpolates partner-controlled values (company names, product names) and is unsafe to hand to a shell — #462/#562 established that agents must spawn `args.slice(1)` instead. But `dashboard`, `invoices audit`, `cost sim`, `subscriptions renewals`, `recommendations list`, and the three `webhooks` list surfaces emitted no `args` at all, leaving an agent following the contract with nothing to spawn and a string it was explicitly told never to tokenize. `cost sim` was the sharp edge: its only suggestion is an `orders create` with an interpolated company name. `recommendations list` was the subtle one — it emitted `orderCommand` (the unsafe display form) as the only executable field while `orderArgs` sat unused on the same record.

**Nothing said whether a suggested command writes.** Read commands routinely suggest writes: `invoices audit` emits five `invoices dispute` calls, `today` emits `recommendations act` and `orders create`. Nothing in the payload distinguished those from the harmless suggestions beside them, so an agent had to match the command string against a prose table in the docs to decide whether it needed approval — exactly the kind of inference that fails silently, and the failure places real orders.

Every emitted action now carries `{ command, args, description, isWrite }`, built through a single `buildAction()` helper so the display string is derived from the same argv the agent runs and the two cannot drift. `isWrite` covers local-machine mutations (`demo on`, `config set`, `cache clear`) as well as Pax8 API writes, and classification prefix-matches subcommand paths to depth 3 — so `webhooks logs` is a read while `webhooks logs retry` is a write.

The agent rule collapses from *"resolve the command path against the read/write lists, then apply the approval protocol if it lands on the write side"* to *"never spawn an action with `isWrite: true` without explicit user approval."*

`--dry-run` deliberately does not make an action `isWrite: false`: safety shouldn't depend on a flag that can be dropped when a command is copied.

Purely additive — existing consumers reading `command` and `description` are unaffected.
