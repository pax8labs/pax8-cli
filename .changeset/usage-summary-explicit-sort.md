---
"@pax8/core": patch
"@pax8/cli": patch
---

Always send `sort=resourceGroup,asc` when listing subscription usage summaries. This supplies an explicit field and direction to avoid the reported server-side `ORDER BY id null` SQL error when sorting is omitted.

Demo usage summaries also sort by resource group before pagination. Usage lines do not have a documented sort parameter; whether that endpoint shares the backend SQL bug requires separate verification.
