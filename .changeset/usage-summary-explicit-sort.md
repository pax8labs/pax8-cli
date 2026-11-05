---
"@pax8/core": patch
"@pax8/cli": patch
---

Always send an explicit, documented sort (`sort=resourceGroup,asc`) when listing subscription usage summaries, and sort demo usage summaries by resource group before pagination.

For context on the `ORDER BY id null` usage-summary 500s seen in Pax8 API logs: they reproduce when sorting by `currentCharges` or `partnerTotal` (with or without a direction), which this CLI has never sent; the logged `pax8-cli/1.0.0` user agent belongs to a different tool.
