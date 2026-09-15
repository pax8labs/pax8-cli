---
"@pax8/cli": patch
"@pax8/core": patch
---

docs: correct the report subcommands on the package page and refresh stale version-pin examples

`packages/cli/README.md` — the README npm renders on the package page — advertised `pax8 report mrr` and `pax8 report growth`. Both were removed (they framed Pax8-cost data as partner-side MRR), so anyone following the package page hit an unknown-command error. Replaced with the actual surface: `pax8 report subscriptions` / `renewals` / `concentration`. Audited every other `pax8 …` reference in that README against the built CLI's own command table; these two were the only stale ones.

Both package READMEs also still showed pre-0.2 pinning examples (`"@pax8/cli": "0.1.1"`, `"@pax8/core": "0.1.0"`), which pointed readers at versions predating the `setAccount` fix. Updated to `0.2.1`.

Docs only — no runtime change. Released so the npm package pages actually pick it up, since they only refresh on publish.
