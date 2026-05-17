---
"@pax8/cli": patch
---

`pax8 clients create` (and its `pax8 companies create` alias) `--help` now documents that the supplied contact is implicitly assigned as primary on all three ContactType values (Admin, Billing, Technical) to satisfy activation, and points partners at `pax8 contacts update` / `pax8 contacts create --type` to re-split those roles afterward. README's Clients section gains a matching one-line note next to the `clients create` example.

No behavior change — help-text + README only. Addresses Franco Aurieme's domain-review finding that the atomic-create path's implicit multi-role primary assignment (correct per `ContactService.accountHasAllPrimaryContacts`, shipped in #381) was invisible to partners who wanted different humans in different roles. Closes #432.
