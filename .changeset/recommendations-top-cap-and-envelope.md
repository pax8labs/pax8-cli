---
"@pax8/cli": minor
"@pax8/claude-skill": minor
---

Cap `pax8 recommendations list` at 10 by default and add `--top <n>` (with `--top 0` for unlimited). Closes #521.

Against the large-portfolio fixture `pax8 recommendations list --json` returned 308 recommendations (101 marked `high`) — no cap, no sort by uplift. That's a context-window grenade for agents and signal-dilution for partners; both surfaces ended up triaging by hand.

**Behavior changes (pre-publish, called out here so partner-readiness consumers see the diff):**

- **New `--top <n>` flag.** Default is `10`. `--top 0` is the documented escape hatch — it opts out of the cap and emits every recommendation. Replaces the implicit "show everything" contract that #521 found was broken on real partner volumes.
- **Sort is now `estimatedMrrUplift` DESC, with `priority` (high > medium > low) as tiebreaker. Recommendations with a null uplift sort last.** Priority tags ("missing security = high") are heuristic; uplift is concrete dollars. A $5k/mo medium opportunity outranks a $500/mo high one — which is what a partner trying to grow MRR actually wants at the top of the list.
- **`pax8 recommendations list --json` is now ALWAYS a wrapped envelope `{ recommendations: Recommendation[], totalAvailable: number }` — even without `--with-actions`.** This is a JSON-shape breaking change for any agent/script that previously did `JSON.parse(stdout)` and treated the result as a flat array. `totalAvailable` is the engine count BEFORE the `--top` cap fires, so consumers can detect the cap and decide whether to re-query with `--top 0`. Capping by default while silently emitting a bare array would have been exactly the anti-pattern #483 is fixing on the report surface — partners and agents need to know what's behind the curtain. Pre-1.0, no deprecation period.
- **`--with-actions` envelope extension.** Already wrapped, but now also carries `totalAvailable` alongside the existing `recommendations` / `nextActions` / `unmatchedProducts`. Shape: `{ recommendations, totalAvailable, nextActions, unmatchedProducts }`.
- **Table-mode footer.** When the cap fires the human render appends `Showing top 10 of 308 recommendations. Use --top 50 or --top 0 to see more.` on stderr, so partners reading the table know there's more behind the cap without having to remember the new flag.
- **Skill tool updated.** `pax8_recommendations` (the `@pax8/claude-skill` tool) now accepts a `top` parameter and the tool description documents the new envelope shape so MCP clients see the cap-and-totalAvailable contract.

Out of scope (intentionally): `--priority` filtering already exists; `recommendations act` already consumes one rec at a time; the dashboard's `highRecs` already caps internally at 12. The engine in `@pax8/core` is unchanged — this is a CLI command-layer change.
