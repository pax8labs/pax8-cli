---
"@pax8/cli": patch
---

**Docs / help text:** Added `JSON output (--json):` sections to `--help` on commands with nested or computed response shapes — `pax8 cost sim`, `pax8 dashboard` (and the `status` alias), `pax8 recommendations list`, `pax8 invoices audit`, `pax8 subscriptions renewals`, `pax8 report mrr`, `pax8 report growth`. Partners parsing `--json` no longer have to run a command to discover its shape; the contract is pinned in `--help`. Renewals and dashboard call out the deprecated `mrrAtRisk` / `arrAtRisk` aliases (per #299) and dashboard calls out the deprecated `createdDate` alias (per #385). Also expanded the README "Metric definitions" section with an explicit STAX taxonomy divergence subsection (CLI 7-category taxonomy and `seat_gap` heuristic vs. canonical STAX / Seat Utilization) and a mapping table — disclosure that previously lived only in `--help` and the module docstring, neither of which `--json` consumers see. Closes #396. No behavior change.
