---
"@pax8/cli": patch
---

`pax8 usage list --help` now explicitly documents the pagination contract — that each per-subscription `/v1/subscriptions/{id}/usage-summaries` fetch accepts `page` / `size`, the default is 50, the max is `LIST_SIZE_CAP` (1000) with stderr-clamp warning per #518, and the fan-out behavior when `--company` or no filter is used (each subscription paged independently, results concatenated). Closes #397.

No behavior change — the flags were always exposed and the cap already enforced. This makes the contract explicit in the Notes block so partners with high-usage subscriptions don't get surprised by truncation. #483 also added the `{ usage, page }` JSON envelope on this command earlier today.
