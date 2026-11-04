# @pax8/claude-skill

A [Claude Code](https://claude.ai/code) skill that wraps [`@pax8/cli`](../cli) commands as agent-callable tools, so AI agents get the same computed intelligence (renewals, invoice audits, Pax8-cost analytics, recommendations) as human operators without reimplementing business logic.

## Why this exists alongside the hosted Pax8 MCP

Pax8 publishes a hosted MCP server at `mcp.pax8.com` for zero-install AI access. This skill is the alternative when you want the CLI's richer command surface (recommendations, invoice audit, Pax8-cost analytics, demo mode) or are scripting against a stable, versioned interface. See [When to use this CLI vs the Pax8 MCP](../../README.md#when-to-use-this-cli-vs-the-pax8-mcp) in the root README for the full comparison.

## What you get

The skill exposes the following CLI command groups as agent tools (see [`src/tools/`](./src/tools)):

- **clients** — list, show, drill into customer details
- **subscriptions** — list, show, renewals tracking
- **invoices** — list and audit billing discrepancies
- **products** — catalog search
- **recommendations** — prioritized growth opportunities with ready-to-run order commands
- **reports** — Pax8-cost analytics (renewals, concentration, subscription rollups)

All tools return structured JSON for downstream agent reasoning.

## Setup

Installing `@pax8/cli` does **not** make Claude Code pick this skill up. Claude Code loads skills from `~/.claude/skills/<name>/SKILL.md` (or a project's `.claude/skills/`), and an npm install writes to neither. Run:

```bash
pax8 skill install              # ~/.claude/skills/pax8/SKILL.md
pax8 skill install --project    # ./.claude/skills/pax8/SKILL.md
```

then start a new Claude Code session. `pax8 skill install --print` writes the skill to stdout if you want to read it first, and `pax8 doctor` flags an installed copy that has drifted from the one your CLI ships. See [Setup (Claude Code)](../../README.md#setup-claude-code) in the root README.

## Behavioral contract

The agent-facing rules (act first, no clarifying questions, parallel fetches, mandatory order previews, output flag conventions, workflow recipes, error handling) live in [`skill.md`](./skill.md) — along with the read/write safety contract that decides what an agent may run on its own and what it must confirm. That file is the source of truth for how Claude is instructed to use the CLI.

Three copies of it exist and they are kept identical on purpose:

| Copy | Who reads it |
|---|---|
| `packages/claude-skill/skill.md` | **Canonical.** Edit this one. |
| `.claude/skills/pax8/SKILL.md` | Claude Code, when working inside this repo (#714). |
| `packages/cli/dist/skill.md` | What `pax8 skill install` writes to a partner's machine (#720). |

The first two are pinned byte-for-byte by a contract test; the third is copied from the canonical file at build time. The `.claude` copy was gitignored for six months, so every correction landed in the canonical file and reached no agent — which is why the drift is now a red build rather than a discovery.

## License

Apache-2.0 — see [LICENSE](../../LICENSE) at the repo root.
