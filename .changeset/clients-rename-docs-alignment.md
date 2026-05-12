---
"@pax8/cli": patch
---

**Docs:** Updated user-facing docs (README, skill.md, AGENTS.md, CLAUDE.md, domain-review.md, UX_GUIDE.md) to use `pax8 clients *` as the canonical command surface, with `pax8 companies *` mentioned once per doc as a deprecated alias. Also audited and fixed stale references to `pax8 contacts add` (already uses `pax8 contacts create` to match the shipped subcommand name — per the project's `create` convention across every other resource) and a stale `--expiration-date` flag listing under `pax8 quotes create` (the flag was removed in #339). No behavior change. Closes #378.
