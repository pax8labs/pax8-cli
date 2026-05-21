---
"@pax8/cli": patch
---

Close #462 follow-up: agent-facing docs now steer programmatic callers to `orderArgs` (the safe argv-style field shipped in #498) instead of inviting them to shell-paste `orderCommand`.

Five surfaces updated in lockstep:

- `CLAUDE.md` "act on a recommendation" row
- `AGENTS.md` matching table row and the longer "Recommendation → order" callout
- `packages/claude-skill/skill.md` "Recommendation → order" callout
- `packages/claude-skill/src/tools/recommendations.ts` MCP tool description

Each now says: prefer `orderArgs.slice(1)` (an argv array with `"pax8"` as element 0) for subprocess / Bash execution. `orderCommand` is documented as a human-readable display string that interpolates the raw partner-controlled `companyName` — safe to render in a preview, unsafe to shell-eval.

No code changes; the code paths in `dashboard.ts`, `recommendations/list.ts`, `recommendations/act.ts`, and `repl.ts` already prefer `orderArgs` per the #509 work, and `getRecommendations` has emitted both fields since #498. This PR just brings the agent-facing prose in line with the existing safe-path implementation.
