---
"@pax8/cli": minor
---

`pax8 companies *` renamed to `pax8 clients *` with `companies` retained as an indefinite deprecated alias via Commander's native `.alias()` mechanism. Both invocations route through the exact same Command graph and action handlers — there's structurally only one command graph, so the surfaces can't drift. Pax8 is structurally moving away from the COMPANY noun in API contracts (PAE-2054 governance, Client Archetype PRD, portal's "New Client Creation Form" GA, v2 quotes API `clientId`). The CLI command surface adopts the user-facing canonical noun now; JSON output fields (`companyId`, `companyName`, etc.) stay aligned with the current public API and will migrate when the API does. The `--company` flag on other commands (`subscriptions list`, `contacts list`, etc.) is unchanged — flag mirrors the API field, no rename until the API renames. Closes #317. Doc updates (README, skill.md, AGENTS.md, CLAUDE.md, domain-review.md) tracked separately under #378.
