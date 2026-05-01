# pax8-cli UX Guide

Conventions for building commands that feel like the rest of the CLI. If you're adding a new command, read this first — most of the work is already done for you in `packages/cli/src/lib/`. Reuse, don't reinvent.

The guiding principle: **every command should be usable by a human at a TTY, scriptable in a pipe, and safe to run in CI.** That single rule explains most of the patterns below.

---

## 1. Command shape

`pax8 <resource> <action> [args] [options]`

- **Resources are plural nouns** (`companies`, `subscriptions`, `invoices`, `orders`).
- **Actions are verbs** (`list`, `show`, `create`, `cancel`, `search`, `audit`, `renewals`).
- One file per action under `packages/cli/src/commands/<resource>/<action>.ts`.
- `<resource>/index.ts` registers the sub-commands; the root program registers the resource via `register*Commands(program)` in `packages/cli/src/index.ts`.

A new resource has the shape:

```
packages/cli/src/commands/widgets/
  index.ts        # registerWidgetsCommands(program)
  list.ts         # widgetsListCommand
  show.ts         # widgetsShowCommand
  create.ts       # widgetsCreateCommand
```

Use Commander.js. Don't reach for an alternative parser.

---

## 2. Flags — required vocabulary

These flags MUST mean the same thing on every command that supports them. If your command needs the concept, use the established flag; don't invent a synonym.

| Flag | Meaning |
|---|---|
| `--json` | Emit pretty-printed JSON to stdout. No table, no colors, no spinners. |
| `--csv` | Emit RFC 4180 CSV to stdout. |
| `--quiet` | No stdout output. Used to check exit code only. |
| `--verbose` | Extra logging to stderr. |
| `--no-color` | Disable ANSI colors. |
| `--page <number>` | 1-based page (we translate to 0-based for the API — see §6). |
| `--size <number>` | Page size. |
| `--status <status>` | Filter by resource status. Capitalized values match the API (`Active`, `Cancelled`). |
| `--company <id\|name>` | Scope to a single company. Accept name or UUID. |
| `--ids-only` | One ID per line on stdout, nothing else. For `xargs` pipelines. |
| `-y, --yes` | Skip confirmation prompts. Also honored: `PAX8_YES=1`. |

Flag names are **kebab-case** (`--ids-only`, `--billing-term`). Positional args are **angle-bracketed** in help (`<id|name>`, `<query>`).

The first four (`--json`/`--csv`/`--quiet`/`--verbose`) and `--no-color`/`--config` are global, registered once on the root program. Don't redeclare them on individual commands — read them via `command.optsWithGlobals()`.

---

## 3. Output — stdout for data, stderr for everything else

This is the rule that makes the CLI scriptable. **Never write data to stderr; never write progress to stdout.** A user piping `pax8 ... | jq` should get clean JSON regardless of whether a spinner was animating in their terminal.

Use `output()` from `packages/cli/src/lib/output.ts` rather than `console.log`. It handles all four formats from a single column definition:

```ts
const columns: Column[] = [
  { key: "name",   header: "Company", format: (v) => formatCompanyName(String(v), 30) },
  { key: "id",     header: "ID",      format: (v) => chalk.dim(String(v).slice(0, 8)) },
  { key: "status", header: "Status",  format: formatStatus },
];

output(rows, { format: ctx.outputFormat, columns });
```

What `output()` gives you for free:

- **`table`** (default in TTYs) — colored headers, two-space indent, terminal-aware word-wrap.
- **`json`** — pretty-printed, 2-space indent.
- **`csv`** — proper escaping for commas, quotes, newlines.
- **`quiet`** — no-op.

**Defaults**: TTY → `table`, non-TTY → `json` (set in `lib/context.ts`). Don't override this; let users override with explicit flags.

Use the formatters in `packages/cli/src/lib/formatters.ts` — don't roll your own:

| Helper | Output |
|---|---|
| `formatCurrency(1234.56)` | `$1,234.56` |
| `formatStatus("Active")` | green `✓ Active` |
| `formatStatus("Cancelled")` | red `✗ Cancelled` |
| `formatStatus("Trial")` | yellow `● Trial` |
| `formatDate(iso)` | `Jan 15, 2026` |
| `formatTimeAgo(date)` | `5d ago` |
| `formatDaysUntil(date)` | `in 12 days`, `tomorrow` |
| `formatQuantity(5)` | `5 seats` (pluralized) |
| `formatCompanyName(name, 30)` | truncated with `…` |

If you need a new format, add it to `formatters.ts`. Don't inline.

---

## 4. Spinners — feedback, never noise

Use `createSpinner()` from `packages/cli/src/lib/spinner.ts`. It writes to stderr, auto-disables when stderr is not a TTY, and respects `PAX8_QUIET=1`.

```ts
const spinner = createSpinner("Fetching companies...").start();
try {
  const result = await ctx.api.companies.list({...});
  spinner.text = "Analyzing portfolio coverage...";   // update mid-flight
  // ...
  spinner.stop();                                      // success: just stop
  output(rows, {...});
} catch (err) {
  handleCommandError(err, spinner);                    // failure: marks ✗ and exits
}
```

Rules:

- One spinner per command. Update its text rather than starting a second.
- Always `stop()` before writing data, or you'll mangle the output.
- Pass the spinner to `handleCommandError` so it gets a `.fail()` on the way out.
- Never use spinners for sub-second operations.

---

## 5. Errors — recoverable by the user

All command-level errors flow through `handleCommandError()` in `packages/cli/src/lib/errors.ts`. It already knows how to format `CliError`, `ApiError`, `ZodError`, and plain `Error`. Your command should just `throw` and let it render.

When you throw an error you control, use `CliError` with all four fields:

```ts
throw new CliError(
  "No active subscriptions found for that company.",
  ["The company may have churned, or the name didn't match."],   // causes
  [`Run ${replCmd("pax8 companies list")} to see active companies.`],  // recovery
  "https://devx.pax8.com/docs/subscriptions"                     // docs
);
```

The user sees:

```
  ✗ No active subscriptions found for that company.

  Causes:
    • The company may have churned, or the name didn't match.

  Recovery steps:
    → Run pax8 companies list to see active companies.

  Docs: https://devx.pax8.com/docs/subscriptions
```

Conventions:

- **Always provide recovery steps.** A user hitting an error should know what to try next.
- Wrap suggested commands with `chalk.cyan(replCmd("pax8 ..."))`. `replCmd` strips the `pax8 ` prefix when running inside the REPL.
- 401/403 and 404 are handled centrally — don't re-handle them per-command.
- Stack traces are never shown. If you need debugging detail, put it in `causes`.
- Exit code is always `1` on error, `0` on success. Don't use other codes.

---

## 6. Pagination — 1-based for humans, 0-based for the API

The Pax8 API is 0-indexed; users expect 1-indexed. Translate at the boundary:

```ts
const userPage = parseInt(allOpts.page, 10);
const apiPage = Math.max(userPage - 1, 0);
const result = await ctx.api.companies.list({ page: apiPage, size: pageSize });
```

Default `--page` to `"1"` and `--size` to `"25"` in the option declaration.

---

## 7. Confirmation prompts — for writes only

Reads never prompt. Writes always prompt unless the user passes `-y` / `--yes` or sets `PAX8_YES=1`.

Three helpers in `packages/cli/src/lib/confirm.ts`:

| Helper | Use for |
|---|---|
| `confirm(msg, {default})` | Standard `[y/n]` — most writes. |
| `confirmWithChange(msg, currentValue, {label})` | `[y/n/c]` — lets the user edit a numeric value (e.g. quantity) inline before confirming. |
| `confirmDestructive(msg, keyword)` | User must type an exact keyword. Reserved for cancellations and deletes. |

Always declare the `-y, --yes` option on commands that prompt:

```ts
.option("-y, --yes", "Skip confirmation prompt")
```

Show the user what they're about to do, in plain English with concrete numbers, *before* asking:

```
  Place order for [DEMO] Acme Corp:
    Microsoft 365 Business Premium × 25 seats
    $22.00/seat/mo · $550.00/mo · annual billing

  Place this order? [y/n/c]
```

---

## 8. Help text — one description, an examples block

Every command needs a one-sentence `.description()` and an `.addHelpText("after", ...)` examples block. The block should show:

1. The simplest usage.
2. The most common filter or option.
3. A `--json` or `--csv` example.
4. A pipeline example (`--ids-only | xargs ...`) when relevant.

```ts
.addHelpText("after", `
Examples:
  pax8 companies list
  pax8 companies list --status Active
  pax8 companies list --coverage
  pax8 companies list --json
  pax8 companies list --ids-only | xargs -I{} pax8 subscriptions list --company {}`)
```

Descriptions are imperative and short: "List all companies", "Show company details", "Cancel a subscription". No trailing period.

---

## 9. Demo mode — every command must work

Setting `PAX8_DEMO=1` swaps the real API client for `MockPax8Client`. **Every command must produce sensible output in demo mode** — it's how new users try the tool before getting credentials, and it's how integration tests run.

You don't have to do anything special: as long as you go through `ctx.api` from `buildContext()`, you're using the right client automatically. Don't read `process.env` to branch on demo mode in command code.

If you add a new API method to `@pax8/core`, add a corresponding mock in `MockPax8Client`. CI will fail for any command that throws under `PAX8_DEMO=1`.

---

## 10. Interactive affordances — TTY only

When the user is at a terminal, we can be more helpful. When they're piping, we must be silent.

- **Default format follows TTY.** `process.stdout.isTTY` decides table vs. JSON. Use `ctx.outputFormat` — don't check `isTTY` yourself.
- **Next-step suggestions** (`promptNextSteps` in `lib/next-step.ts`) drill into a row by number after a `list`. Only emit on TTY, only when format is `table`, and only on stderr.
- **Hints** like `Add --coverage to see uplift potential` go on stderr in dim text, only in TTY mode. Never in `--json`, `--csv`, or `--quiet`.

If a feature would corrupt a JSON pipe, it doesn't ship without a TTY guard.

---

## 11. Naming reference

| Thing | Convention | Example |
|---|---|---|
| Resource directory | plural lowercase | `subscriptions/` |
| Command file | action verb | `cancel.ts` |
| Exported `Command` | `<resource><Action>Command` | `subscriptionsCancelCommand` |
| Flag | kebab-case | `--billing-term` |
| Env var | `PAX8_<SCREAMING_SNAKE>` | `PAX8_DEMO`, `PAX8_YES`, `PAX8_QUIET` |
| Status values | match API (capitalized) | `Active`, `Cancelled`, `Trial` |
| Currency | `formatCurrency()` | `$1,234.56` |
| Dates | `formatDate()` | `Jan 15, 2026` |

---

## 12. Checklist for a new command

Before opening the PR:

- [ ] Lives at `packages/cli/src/commands/<resource>/<action>.ts` and is registered in `<resource>/index.ts`.
- [ ] One-sentence `.description()`.
- [ ] `.addHelpText("after", ...)` with 4+ examples including `--json` and a pipeline.
- [ ] Reuses standard flags (`--json`, `--csv`, `--quiet`, `--page`, `--size`, `--ids-only`, `-y`) where applicable. No invented synonyms.
- [ ] Reads options via `command.optsWithGlobals()`.
- [ ] Goes through `buildContext()` for API access.
- [ ] Uses `createSpinner()` for any operation > 500ms.
- [ ] Renders output via `output()` with a `Column[]` definition. Stdout-only.
- [ ] Uses formatters from `lib/formatters.ts`. No inline currency/date strings.
- [ ] Errors flow through `handleCommandError()`. Custom errors use `CliError` with causes + recovery + docs.
- [ ] Writes prompt for confirmation; honor `-y` / `--yes` / `PAX8_YES=1`.
- [ ] Works under `PAX8_DEMO=1` end-to-end.
- [ ] Subprocess test in `packages/cli/src/__tests__/` covers TTY format, `--json`, and an error path.
- [ ] Output is byte-stable: no timestamps or random IDs in the rendered output unless they came from the (mock) API.
