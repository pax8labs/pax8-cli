---
"@pax8/cli": patch
---

Fix REPL bare-number drill-in regression: typing a row number after a list command silently did nothing. The REPL dispatch regex at `lib/repl.ts:191` requires `command` strings in `pending-actions.json` to start with `pax8 ` (defense-in-depth from #506, so a tampered cache file can't dispatch arbitrary subcommands), but `clients list` and the `list-drill-in.ts` helper (rolled out across `subscriptions / orders / invoices / quotes list` per #418/#556) wrote the unprefixed form `clients more 3` / `<resource> show <id>`. The regex never matched and the bare-number input fell through to `node cliPath 3`, which the CLI rejected as `unknown command '3'`. Prefix both writers with `pax8 ` to honor the contract. Closes #561.

Adds a contract test in `repl.integration.test.ts` that reads `pending-actions.json` after `clients list` and asserts every entry's `command` matches the same `/^pax8\s+\w/` regex the production dispatch checks — so a future writer that drops the prefix is caught at the same condition.
