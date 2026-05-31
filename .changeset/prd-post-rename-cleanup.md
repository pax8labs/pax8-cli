---
"@pax8/cli": patch
---

`docs/PRD.md`: update the post-#443 reshape so the document matches the
current `pax8 report subscriptions` / `pax8 report concentration` /
`pax8 report renewals` surface instead of the retired `pax8 report mrr` /
`pax8 report growth` framing. Closes #460.

`AGENTS.md` and `README.md` were already clean of stale `report mrr` /
`PAX8_API_TIMEOUT` references; the lingering README mention is
explicitly historical and conforms to #460's AC #3. No code change.
