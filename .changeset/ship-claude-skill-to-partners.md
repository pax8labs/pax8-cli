---
"@pax8/cli": minor
"@pax8/core": patch
---

feat(skill): ship the Claude skill to partners — `pax8 skill install` (#720)

**The agent safety contract reached nobody outside this repo.** `packages/claude-skill/skill.md` is where the read/write classification lives — which commands run autonomously, which need explicit approval, the `isWrite` rule, the #707 pre-order SKU check. It shipped in neither published artifact: `@pax8/cli` packs only `dist`, and `@pax8/claude-skill` is `private: true`. A partner running Claude Code against `pax8` got an agent improvising around a CLI that can place real orders.

Two claims in the docs said otherwise. `packages/claude-skill/README.md` said the skill "is auto-discovered by Claude Code once `@pax8/cli` is installed and on `PATH`" — Claude Code discovers skills from `~/.claude/skills/<name>/SKILL.md` or a project's `.claude/skills/`, and an npm install writes to neither. The root README had a "Setup (Claude Code)" heading with no setup under it. Both are corrected, along with a `companies` alias the claude-skill README still advertised after #476 removed it.

**`pax8 skill install`**, not a postinstall hook. A postinstall that writes into `~/.claude` is invisible, fires on CI installs, and mutates a directory owned by a different tool; installing an instruction file that governs whether an agent asks before spending money should be a deliberate act.

```
pax8 skill install [--global|--project] [--force] [--print] [--yes]
```

- `--global` (default) → `~/.claude/skills/pax8/SKILL.md`, honoring `CLAUDE_CONFIG_DIR`; `--project` → `./.claude/skills/pax8/`.
- `--print` writes the skill to stdout and installs nothing — a read, so it stays raw markdown even under `--json`.
- An install already matching the shipped copy is a no-op, not a rewrite.
- A copy the CLI can't prove it wrote is **not** overwritten. Each install records a `.pax8-skill.json` provenance file, which is what separates *stale* (our content, older version — refreshed without ceremony) from *edited* (the partner's own changes — refused, with a line-count summary and the first differing line, until `--force`).
- Classified as a **write** in the safety contract and in `WRITE_COMMAND_PATHS`, so `isWrite: true` rides on every suggestion of it. Without a TTY and without `--yes` it refuses rather than installing unattended.
- A symlinked `SKILL.md` is refused outright rather than silently replaced — a symlink there is somebody's deliberate wiring to a checkout.

**`pax8 doctor` now reports drift.** A partner who installed once and upgraded the CLI five times is running an old contract against a new command surface, with nothing to tell them — the same failure this repo spent a release cycle on when `.claude/skills/pax8/SKILL.md` sat six months behind the canonical file (#714). Not installed is a pass (most partners don't use Claude Code); an installed copy that has drifted is a `✗` naming the exact command that fixes it. Doctor's `nextActions` now go through `buildAction()` so each carries spawn-safe argv and an `isWrite` flag — it suggests `auth login`, `config init`, and now `skill install`, all of which mutate local state.

**Distribution.** The build copies the canonical `skill.md` into `packages/cli/dist/`, which `files` already packs — no third tracked copy of a file that already exists twice. `npm pack --dry-run` is asserted in CI, because a build that skipped the copy step would install the command everywhere with nothing to install.

Telemetry gains three fixed-enum fields (`skill_action`, `skill_scope`, `skill_previous_state`) — no paths, no content. How many partners are running a stale safety contract is the question this issue exists to answer.
