---
"@pax8/cli": minor
"@pax8/core": minor
---

Strip deprecated aliases pre-public-launch (#476).

Six alias families removed — all flagged in code as "remove in v0.3.0 / v1.0" or "one-cycle alias." Pre-launch is the cheapest time to take the breaking change; once we go public, external users adopt them and back-compat becomes a multi-year commitment.

**CLI command surface (removed):**
- `pax8 status` — canonical: `pax8 dashboard`
- `pax8 companies *` — canonical: `pax8 clients *`. The `companies` verb was the original surface but #317 made `clients` canonical; CLAUDE.md previously documented `companies` as an "indefinite" alias, which the issue rightly flagged as a "soft remove someday" trap. Cut now.
- `pax8 webhooks create --events` — canonical: `--topics`

**JSON / type surface (removed):**
- `mrrAtRisk` field aliases (canonical: `mrrRenewing`, per #298)
- `arr*` field aliases (canonical names per #298)
- `createdDate` / `expiresOn` shadow fields (canonical: `createdAt`, `expiresAt`, per #385)

**Out of scope:**
- Wire-side field names (`companyId`, `companyName`, body `expiresOn` on PUT) — unchanged. These are the Pax8 API contract.
- The `--company` flag on commands that operate on a customer — unchanged. Matches the wire-side ID/name fields.

Migration: a one-PR sweep updated CLAUDE.md, UX_GUIDE.md, AGENTS.md, skill.md, claude-skill tool descriptions, and every test that referenced the removed surface.
