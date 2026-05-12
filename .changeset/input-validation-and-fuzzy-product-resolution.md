---
"@pax8/cli": minor
---

Fail-fast input validation on enum-bearing flags + inline "Did you mean" suggestions on fuzzy product-name resolution. Closes #408 (partner-walkthrough Group A: findings #2, #8, #9).

Before this change, a typo like `pax8 subscriptions list --status FooBar` round-tripped to the API and returned `[]` — the partner debugged an "empty result" mystery instead of fixing a typo. Similarly, `pax8 orders create --product "Microsoft 365"` dead-ended with "Product not found" even though the catalog had close matches; the partner had to round-trip through `pax8 products search` to find the canonical name.

**Enum validation (newly wired, 9 flag/command pairs).** New `validateEnum()` and `validateEnumList()` helpers in `packages/cli/src/lib/validate.ts` fail-fast at the CLI layer with a `CliError(ERROR_INVALID_INPUT)` carrying the full allowed set. Wired across:

- `pax8 subscriptions list --status` — the canonical case from finding #2.
- `pax8 companies list --status` — same shape (#9).
- `pax8 invoices list --status`.
- `pax8 quotes list --status` — case-insensitive (server-side wire enum is lowercase).
- `pax8 recommendations list --priority` and `--type`.
- `pax8 recommendations act --priority`.
- `pax8 orders create --billing-term` (and per-`--line-item billing-term=` entries).
- `pax8 cost sim --billing-term`.
- `pax8 quotes create --billing-term`, `pax8 quotes update --billing-term`, `pax8 quotes line-items add --billing-term`.

The existing `pax8 subscriptions update --billing-term` already validated via `validateBillingTermInput()` (PR #336) and is left in place — the new helper is a generic floor, not a replacement.

**Fuzzy product resolution with suggestions.** `resolveProduct()` now ranks the catalog by token-overlap on a miss and surfaces the top 3 as inline `Did you mean: <name> (<id>)` recovery steps. The "Multiple matches" branch also includes IDs so the partner can copy-paste a canonical product reference without round-tripping through `pax8 products search`. Benefits every command that resolves product names: `orders create`, `quotes line-items add`, `quotes create`, `quotes update`, `cost sim`, and `products show`.

**No existing behavior changes** for valid input — every passing flag value still resolves the same way. Help text on affected commands now lists the canonical accepted set explicitly (some already did per #250; the rest are aligned).
