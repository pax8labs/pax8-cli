---
"@pax8/cli": patch
"@pax8/core": patch
---

Answer "why is this recommended?" — two disclosure layers on `pax8 recommendations`.

UXR F5 (#655), the highest-leverage single finding in the 2026-07-02 readout. Partners repeatedly asked what a recommendation was based on, and couldn't answer from the table alone. Ships as an inline snippet + a drill-down subcommand.

**Layer 1 — inline `Rationale` column in `recommendations list`:**

New engine field `Recommendation.rationaleSnippet` — a short quantitative anchor per rec, populated at every emit site:

- **seat_gap**: e.g. `30/150 backup` — the customer-specific ratio.
- **cross_sell rule**: e.g. `no backup`, `no identity/MFA` — the categorical gap.
- **zero-active-subs**: `no active subs`.

Renders as a new column between `Recommendation` and `Pax8 Cost+`. `--json` shape gains one new required field on `Recommendation` (see below).

**Layer 2 — `pax8 recommendations why <n>`:**

Standalone drill-down subcommand alongside `list` / `act` / `upsell`. Reads the cache written by `list` (no second API call), expands rec `#n` into full rationale plus a "Why it ranks here" paragraph explaining the sort. Cross-references `pax8 explain` for anchor terms so partners can chase definitions without leaving the workflow.

- Text output includes rationale, sort narrative, and orderable / target-seat context.
- `--json` envelope carries `reason`, `rationaleSnippet`, `seeAlso[]`, and every other cached field.
- New `ERROR_RECOMMENDATION_NOT_FOUND` machine-readable code fires on cache-miss or out-of-range with a clear recovery hint. `loadCache()` guards against corrupted / stale JSON on disk, converting every read/parse failure into the same structured error.

**Breaking change for direct `@pax8/core` consumers:** `Recommendation.rationaleSnippet: string` is now required (not optional). Every in-repo constructor is covered — the risk is external packages importing the type and building instances directly. Set the field to a short (<40 char) anchor.

Closes #655.
