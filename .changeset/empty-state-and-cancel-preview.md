---
"@pax8/cli": patch
---

Polish two partner-walkthrough findings (#409 — Group B):

**Empty-state UX in table mode.** List commands that already routed through the `emptyState` API now also pass a structured `filtersApplied` map; the renderer surfaces it as a single "Filters applied: …" line directly under the "No <resource> found." headline. This answers "why is this empty?" with the partner's own filter values before any speculative reasons. JSON / CSV / `--ids-only` / quiet output contracts are unchanged — agents and pipelines reading `--json` still see exactly `[]`. Touched commands: `companies list`, `subscriptions list`, `orders list`, `invoices list`, `quotes list`, `usage list`, `products list`, `products search` (refactored off ad-hoc empty handling onto the shared helper).

**Commitment-aware cancel preview.** `pax8 subscriptions cancel <id>` now prints a one-line headline branch in table mode BEFORE the confirmation prompt: committed subs show `This subscription has an active commitment ending YYYY-MM-DD.` (then the existing yellow `⚠ COMMITMENT ACTIVE` block), and uncommitted subs show `This subscription has no active commitment. Cancellation will take effect immediately.` This addresses the walkthrough Finding #7 where a Monthly-sub partner had no pre-flight signal that cancellation was immediate. JSON mode is unchanged. Vocabulary stays on the canonical "commitment term end date" framing (no ETF / penalty / fee per the Direct User Agreement).
