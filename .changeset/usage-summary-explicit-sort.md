---
"@pax8/core": patch
"@pax8/cli": patch
---

Always send `sort=resourceGroup,asc` when listing subscription usage summaries. This supplies an explicit field and direction to avoid the reported server-side `ORDER BY id null` SQL error when sorting is omitted.
