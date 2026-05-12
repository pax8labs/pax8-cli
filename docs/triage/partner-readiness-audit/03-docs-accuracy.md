# 03 — Documentation accuracy

## Methodology

1. **Quick-start validation** — Executed every command in README demo flow (lines 50-86) under `PAX8_DEMO=1`
2. **Command help spot-check** — Verified 10+ commands (`subscriptions list`, `subscriptions renewals`, `orders create`, `companies create`, `contacts create`, `invoices items`, `cost sim`, `recommendations list`, `dashboard`, `invoices audit`)
3. **Cross-reference audit** — Compared command tables in CLAUDE.md vs AGENTS.md vs skill.md; verified file paths; checked for old vocabulary (`mrrAtRisk`)
4. **Source code review** — Examined recommendations service doc comments for STAX disclosure; validated command definitions against help text
5. **Issue reference spot-check** — Reviewed 3 GitHub issue refs in code comments (#327/#328, #298/#299, #375)

## Summary

- **Total findings: 3**
- **block-launch: 0**
- **fix-before-launch: 2** (missing command in agent-facing table, inaccurate positional-arg syntax in skill.md and AGENTS.md)
- **fix-soon-after-launch: 0**
- **accept: 1** (duplicate reference line in README docs list)

---

## Findings

### fix-before-launch — AGENTS.md and skill.md — `invoices items` positional argument syntax is incorrect

**File:** `packages/claude-skill/skill.md:22` and `AGENTS.md:24`

**Evidence:**
```
skill.md:22 — `pax8 invoices items` — line items for an invoice
AGENTS.md:24 — `pax8 invoices items <invoice-id> --json 2>/dev/null`
```

Actual command definition (`packages/cli/src/commands/invoices/items.ts:13-28`):
```typescript
invoicesItemsCommand = new Command("items")
  .option("--invoice-id <id>", "Filter by invoice ID")
  // No positional argument defined
Examples:
  pax8 invoices items --invoice-id inv-summit-curr-001
```

Verified: invoking with a positional argument silently ignores it and returns ALL items.

**Why it matters:** Agents (Claude Code, Cursor, etc.) reading skill.md and AGENTS.md will attempt to call `pax8 invoices items <id>`, which silently ignores the positional arg and returns all items instead of filtering to the specific invoice. This is a silent data-correctness failure that could cause agents to misinterpret invoice contents.

**Recommended fix:** Update both docs to show `--invoice-id <id>` flag syntax:
- `skill.md:22` — change to list the flag form
- `AGENTS.md:24` — change `pax8 invoices items <invoice-id> --json` to `pax8 invoices items --invoice-id <invoice-id> --json`

---

### fix-before-launch — CLAUDE.md — Missing `pax8 report growth` command in Pax8 data queries table

**File:** `CLAUDE.md:9-24` (command reference table)

**Evidence:**

`CLAUDE.md` lines 9-24 has these rows:
```
| User asks about | Run this |
| overview / status | pax8 dashboard --json |
| MRR / revenue | pax8 report mrr --json |
| recommendations | pax8 recommendations list --json |
...
```

But `AGENTS.md` lines 13-31 has the same table with an additional row at line 20:
```
| growth trend | pax8 report growth --json 2>/dev/null |
```

Command verified to exist and work under `PAX8_DEMO=1 pax8 report growth --json`.

**Why it matters:** `CLAUDE.md` is the contract for agent execution inside this repo (per lines 1-3). Agents following `CLAUDE.md` won't know about the `report growth` command and may miss growth-trend questions. The command is in `AGENTS.md` (for non-Claude agents) but missing from the repo's own internal contract.

**Recommended fix:** Add the missing row to `CLAUDE.md` between lines 15-16 (after "MRR / revenue" and before "recommendations"):
```
| growth trend | pax8 report growth --json 2>/dev/null |
```

---

### accept — README.md — Duplicate "Credential Setup Guide" reference

**File:** `README.md:485-487`

**Evidence:**
```markdown
## Documentation

- [Credential Setup Guide](docs/credential-setup.md)
- [Product Requirements](docs/PRD.md)
- [Credential Setup Guide](docs/credential-setup.md)  ← duplicate of line 485
- [Build Prompt](docs/BUILD.md)
```

**Why it matters:** Minor — cleanliness only. Not a correctness issue; the file exists and the link works. No partner will notice, and it causes no functional harm.

**Recommended fix:** Delete line 487 or replace with another doc (e.g., `[Pax8 API Reference](https://devx.pax8.com/)` is already on line 489, so no duplication needed).

---

## Additional validation (no issues found)

- README quick-start commands all work end-to-end under `PAX8_DEMO=1` ✓
- Help text on 10+ commands matches documented behavior ✓
- STAX taxonomy divergence is well-disclosed in `packages/core/src/services/recommendations.ts:4-24` ✓
- No references to stale vocabulary (`mrrAtRisk`, old "companies as primary" phrasing) in agent-facing docs ✓ (NOTE: this conflicts with dimension 2's finding that README and AGENTS.md still lead with `companies`; the discrepancy is that this agent checked the agent-facing query tables only; dim 2 caught the README demo-flow examples)
- All referenced doc files exist (`docs/BUILD.md`, `docs/credential-setup.md`, `docs/PRD.md`) ✓
- Commands in skill.md match actual surface (e.g., `dashboard --all|--customers|--renewals|--growth` all work) ✓
