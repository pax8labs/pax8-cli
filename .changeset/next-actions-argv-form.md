---
"@pax8/cli": minor
---

**Breaking for agent consumers of `nextActions[]`** — every entry now carries both a `command` display string and a structured `args` argv array (matches the `orderArgs` / `orderCommand` pair resolved for recommendations in #462/#509). Agents must spawn `args.slice(1)` directly via their tool's argv form; the `command` field is for human display only and should never be tokenized or piped to a shell. Closes #562.

Pre-fix, `pax8 subscriptions list --product <value> --json --with-actions` interpolated `<value>` straight into `nextActions[0].command` — an agent that handed the display string to a shell faced the same shell-injection class that `orderCommand` had before its `orderArgs` cousin shipped. The full surface affected: every list command's `nextActions` page-action plus the drill-in / filter / audit suggestions composed on top.

Code changes:
- `buildNextPageAction` in `lib/output.ts` now takes a `readonly string[]` argv instead of a pre-built string, and returns `{ command, args, description }`.
- New exported helper `displayCommandFromArgs(args)` renders an argv into a readable command line, quoting only when needed; same source of truth as the `command` field returned by `buildNextPageAction`.
- Eight list commands rebuilt their `nextPageCommand` construction as argv: `clients list`, `subscriptions list`, `orders list`, `invoices list`, `invoices items`, `products list`, `quotes list`, `contacts list`. Each individual `nextActions.push({ ... })` callsite also now emits the `args` field alongside `command`.
- New contract test at `packages/cli/src/__tests__/next-actions-argv-contract.test.ts` asserts every nextActions entry carries `command` + `args[0] === "pax8"` AND that a malicious `--product` value lands as a single argv slot, not interpolated.

Documentation updates:
- `AGENTS.md` and `packages/claude-skill/skill.md`: `--with-actions` row updated to direct agents at `args` over `command`.
- `CLAUDE.md`: new "nextActions argv contract (#562)" note alongside the existing list-envelope (#483) note.

No behavior change for human REPL / table users — the display strings rendered in pagination footers are unchanged (derived from the same argv via `displayCommandFromArgs`).
