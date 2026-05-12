# 02 — Internal Consistency

## Methodology

Systematic scan across six consistency dimensions:

1. **Vocabulary** — `mrrAtRisk` → `mrrRenewing` rename (#299), "Partner Gross MRR" qualifiers, "commitment term end date" terminology
2. **Command naming** — `pax8 clients *` (primary) vs `pax8 companies *` (alias) coverage, help text
3. **Flag conventions** — `--company <id|name>` consistency, kebab-case, meaning across commands
4. **JSON schemas** — Field names, timestamp conventions (`createdDate` vs `updatedAt`), money types, ID formats
5. **Exit codes** — Use of canonical `ERROR_*` constants from `packages/core/src/errors/codes.ts`
6. **Error handling** — `CliError` wrapper usage, structured vs raw API responses

Scanned: 
- `packages/core/src/api/types.ts` (canonical schema definitions)
- `packages/core/src/errors/codes.ts` (error code constants)
- `packages/cli/src/commands/**/*.ts` (command implementations, flags, error handling)
- `docs/UX_GUIDE.md`, `README.md`, `AGENTS.md`, `packages/claude-skill/skill.md` (user-facing vocabulary)
- `CHANGELOG.md`, `docs/pm-review-response-2026-05.md` (recent refactor context)

---

## Summary

**Total findings: 5 (1 block-launch, 2 fix-before-launch, 2 fix-soon-after-launch, 0 accept)**

| Severity | Count | Issues |
|----------|-------|--------|
| block-launch | 1 | Timestamp field naming inconsistency (createdDate + updatedAt + created mixed across types) |
| fix-before-launch | 2 | Company.created (bare) vs Webhook.updatedAt (camelCase); README/AGENTS.md still reference `companies` as primary |
| fix-soon-after-launch | 2 | Quote createdOn/expiresOn vs Order createdDate; deprecation clarity for mrrAtRisk alias |
| accept | 0 | — |

---

## Findings

### block-launch — JSON schemas — Timestamp field naming inconsistency

**File:** `packages/core/src/api/types.ts:140-141` (Company), `types.ts:452` (Order), `types.ts:504` (Subscription), `types.ts:667-668` (Quote), `types.ts:701` (Webhook), `types.ts:723` (Webhook.updatedAt)

**Evidence:**
```
Company:      { created, updatedDate }
Order:        { createdDate }
Subscription: { createdDate }
Quote:        { createdOn, expiresOn }
Webhook:      { createdDate, updatedAt }
```

Grep across types:
```
/packages/core/src/api/types.ts:  created: z.string().optional(),           # Company only
/packages/core/src/api/types.ts:  updatedDate: z.string().optional(),       # Company + (none else)
/packages/core/src/api/types.ts:  createdDate: z.string(),                  # Order, Subscription
/packages/core/src/api/types.ts:  createdOn: z.string(),                    # Quote only
/packages/core/src/api/types.ts:  updatedAt: z.string().optional(),         # Webhook only
```

**Why it matters:**

Partners writing `--json` consumers (scripts, agents, integrations) expecting a canonical timestamp field pattern face silent failures. Webhook `updatedAt` exists alongside other types' `createdDate` / `created` fields; a generic timestamp extractor must handle five naming conventions for what semantically is "when did this record change." JSON output is the contract for agent/script consumers — this inconsistency breaks composability.

**Recommended fix:**

Establish canonical timestamp naming:
- Created: `createdAt` (ISO 8601, always present on read)
- Updated: `updatedAt` (ISO 8601, optional, populated only if the type supports updates)

Migrate each type at the schema level:
- Company: `created` → `createdAt`; keep `updatedDate` but rename to `updatedAt`
- Order: no change needed (already `createdDate`; add `updatedAt` if API supports it)
- Subscription: no change needed
- Quote: rename `createdOn` → `createdAt`, `expiresOn` → `expiresAt` (aligns with semantic "when does it expire")
- Webhook: `createdDate` → `createdAt` (keep `updatedAt` as-is)

Emit deprecated aliases for one minor cycle so existing `--json` consumers don't break (follow the `mrrAtRisk` pattern from #299). Update all help text, README, and agent-facing contracts.

---

### fix-before-launch — Docs vocabulary — README and AGENTS.md still reference `companies` as primary command

**File:** `README.md:84` (demo flow), `README.md:99-106` (Companies section), `AGENTS.md:78,80-81` (command examples)

**Evidence:**

README Demo Flow (line 84):
```
pax8 companies list                      # Browse customers (type # to drill in)
pax8 companies more "Acme Corp"          # Full customer summary
```

AGENTS.md examples (lines 78-81):
```
| companies / customers | `pax8 companies list --json 2>/dev/null` |
...
- `pax8 companies list --json 2>/dev/null` (or ...)
- `pax8 companies more <name>` — rich read-only summary
```

**Why it matters:**

PR #379 and the `companies/index.ts` comment (line 12-26) make clear that `pax8 clients` is the canonical user-facing command and `pax8 companies` is a deprecated alias. Yet the README's "Quick Start" and "Demo Flow" sections (user-facing discovery docs) and AGENTS.md (agent training) still lead with `companies`. Partners following the README will never learn the canonical surface; agents trained on AGENTS.md perpetuate the old terminology.

**Recommended fix:**

Update before v0.1.0 ships:
- README.md: swap `pax8 companies list` → `pax8 clients list` throughout (lines 84, 102, 105)
- Add a sidebar note: "Alias: `pax8 companies *` works identically but is deprecated."
- AGENTS.md: swap command examples to `pax8 clients *` (line 78, 80-81)
- Retain both in the safety contract (skill.md line 16) so both invocations are documented, but lead with `clients`.

---

### fix-before-launch — Naming consistency — Company.created is bare; inconsistent with all other types' camelCase timestamps

**File:** `packages/core/src/api/types.ts:140`

**Evidence:**
```typescript
export const CompanySchema = z.object({
  // ... other fields ...
  created: z.string().optional(),          // <-- bare, not camelCase
  updatedDate: z.string().optional(),       // <-- not camelCase either (should be updatedAt)
});
```

All other types use camelCase `createdDate` or `createdAt`/`createdOn`. Company uses bare `created`.

**Why it matters:**

Type inconsistency signals incomplete refactoring. If Company's created field is from an older API version or internal naming, the schema should document why (see types.ts comment patterns elsewhere). Right now it reads as an oversight.

**Recommended fix:**

Rename `Company.created` → `Company.createdAt` alongside the broader timestamp-naming fix (block-launch finding). Emit as deprecated alias for one cycle.

---

### fix-soon-after-launch — JSON schemas — Quote uses createdOn/expiresOn, Order uses createdDate

**File:** `packages/core/src/api/types.ts:667-668` (Quote), `types.ts:452` (Order)

**Evidence:**
```typescript
export const QuoteSchema = z.object({
  // ... 
  createdOn: z.string(),       // Quote naming
  expiresOn: z.string().optional(),
});

export const OrderSchema = z.object({
  // ...
  createdDate: z.string(),    // Order naming
  // no expiresDate equivalent
});
```

Comment in types.ts:662-666 documents this was intentional per quote v2 API alignment, but the naming divergence from Order creates a second-level inconsistency within "resources that track time."

**Why it matters:**

Minor but visible in `--json` output for agents doing comparative analysis (order vs quote lifecycle). The comment shows awareness of the API's field naming; this is a known-good state rather than a bug. However, it contributes to the overall timestamp fragmentation.

**Recommended fix:**

Document in CHANGELOG or `docs/NAMING_CONVENTIONS.md` why Quote uses `createdOn` (API alignment) while Order uses `createdDate` (internal consistency). This is a "known good reason for divergence" rather than a bug, but worth explaining. Revisit alongside the block-launch timestamp fix to see if a unified pattern is possible.

---

### fix-soon-after-launch — Vocabulary — mrrAtRisk deprecation clarity in help text and JSON

**File:** `packages/cli/src/commands/subscriptions/renewals.ts:30-31` (help text), `packages/cli/src/commands/dashboard.ts:263` (JSON emission), `CHANGELOG.md:23` (deprecation note)

**Evidence:**

Help text (renewals.ts:30-31):
```
The previous \`mrrAtRisk\` / \`arrAtRisk\` keys are emitted alongside as
```

The comment is incomplete (ends mid-sentence). Help text should explicitly state:
- "These are deprecated aliases; use `mrrRenewing` instead."
- "Aliases will be removed in v0.3.0" (or whenever).

CHANGELOG.md documents the deprecation clearly but users reading `pax8 subscriptions renewals --help` don't see it.

**Why it matters:**

Partners writing scripts against `--json` output don't know the deprecation timeline. Some may assume both fields are stable and bake both into their parsing logic. Clarity in help text and README prevents surprise when v0.3.0 drops the aliases.

**Recommended fix:**

1. Fix the incomplete help text in renewals.ts:30-31 to complete the sentence and add deprecation timeline.
2. Add a "Deprecated fields" subsection to the command's help:
   ```
   Deprecated fields (removal in v0.3.0):
     mrrAtRisk   → use mrrRenewing instead
     arrAtRisk   → use arrRenewing instead
     totalMrrAtRisk → use totalMrrRenewing instead
   ```
3. Add a note to README.md's renewals example clarifying the aliases are emitted for compatibility.

---

## Spot checks — Consistency maintained

### ✓ Flag `--company <id|name>` consistency

Checked across: `invoices list`, `invoices audit`, `invoices dispute`, `subscriptions list`, `subscriptions renewals`, `orders list`, `orders create`, `contacts list`, `contacts show`, `recommendations list`, `usage list`, `quotes list`.

**Result:** All consistently use `--company <id|name>` with identical descriptions ("Filter by company ID or name" / "Company ID or name (required)"). No synonyms (`--cid`, `--client`, `--account`). ✓

### ✓ Kebab-case flag naming

Checked: `--ids-only`, `--with-actions`, `--billing-term`, `--commitment-term`, `--status`, `--page`, `--size`, `--company-only`.

**Result:** All multi-word flags use kebab-case. No camelCase flags found. ✓

### ✓ Exit codes use canonical constants

Spot-checked 12 commands: `init`, `companies/create`, `orders/create`, `quotes/create`, `invoices/dispute`, `subscriptions/renewals`.

**Result:** All `throw new CliError(...)` calls pass an `ERROR_*` constant from `packages/core/src/errors/codes.ts` as the fifth argument. No raw string error codes or bare `throw Error()`. ✓

### ✓ "commitment term end date" vocabulary discipline

Grep for "ETF", "penalty", "fee", "early-termination" in help text and error messages: 0 matches.

Grep for "commitment term end date": 4 matches in `packages/cli/src/commands/subscriptions/cancel.ts` and docs.

**Result:** Vocabulary regression-tested per #302. No "ETF" / "penalty" framing found. ✓

### ✓ "Partner Gross MRR" qualifier present

Checked: `packages/cli/src/commands/report/mrr.ts`, `subscriptions/renewals.ts`, `report/growth.ts`, `dashboard.ts`.

**Result:** All MRR labels include "Partner Gross MRR" qualifier in help text and comments. ✓ Consistent with #298.

### ✓ JSON field names in list commands

Spot-checked: `subscriptions list`, `invoices list`, `orders list`, `companies list`.

**Result:** All return arrays of objects with consistent field names (`companyId`, `companyName`, `productId`, `productName`, `price`, `total`, etc.). No field-name divergence between commands. ✓

---

## Recommendations for Josh

1. **Priority 1 (blocking launch):** Consolidate timestamp field naming across all types. The createdDate + updatedAt + created + createdOn scatter breaks agent composability. Emit deprecated aliases for one cycle. Scope: ~2 hours, affects 5 schemas + help text.

2. **Priority 2 (before v0.1.0 general availability):** Update README and AGENTS.md to lead with `pax8 clients *` instead of `pax8 companies *`. This is user-facing discovery; getting it wrong early is costly. Scope: ~15 minutes.

3. **Priority 3 (v0.1.1):** Clarify mrrAtRisk deprecation timeline in help text and README so partners don't get surprised when aliases drop in v0.3.0. Document the "why" (API conflict with Pax8's Revenue at Risk Predictor) if you haven't already. Scope: ~20 minutes.

All other consistency checks pass. The refactors (#298, #299, #379) landed cleanly; these three findings are loose ends rather than systemic drift.

