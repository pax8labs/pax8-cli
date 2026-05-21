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

**Empty lists — render a message, not an empty table.** When a list command would return zero rows, an empty header-and-divider table reads as "something is broken." Pass an `emptyState` to `output()`:

```ts
output(rows, {
  format: ctx.outputFormat,
  columns,
  emptyState: {
    headline: "No invoices found.",
    reasons: ["This may be a fresh tenant with no historical billing yet."],
    suggestions: [
      { command: "pax8 invoices list --status Unpaid", description: "show only unpaid" },
    ],
  },
});
```

`emptyState` only fires in `table` mode with 0 rows. `--json` still emits `[]`, `--csv` still emits a header row, `--ids-only` still emits nothing — those are agent / pipeline contracts. The message itself goes to **stderr** so a `--json | jq` pipeline isn't disrupted if the user's terminal happens to render the human path. Gate any trailing footer (`N <thing>` count, "Try next" block) with `if (rows.length > 0)` so it doesn't print alongside the empty-state message.

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
  [`Run ${replCmd("pax8 clients list")} to see active clients.`],  // recovery
  "https://devx.pax8.com/docs/subscriptions"                     // docs
);
```

The user sees:

```
  ✗ No active subscriptions found for that company.

  Causes:
    • The company may have churned, or the name didn't match.

  Recovery steps:
    → Run pax8 clients list to see active clients.

  Docs: https://devx.pax8.com/docs/subscriptions
```

Conventions:

- **Always provide recovery steps.** A user hitting an error should know what to try next.
- Wrap suggested commands with `chalk.cyan(replCmd("pax8 ..."))`. `replCmd` strips the `pax8 ` prefix when running inside the REPL.
- 401/403 and 404 are handled centrally — don't re-handle them per-command.
- Timeouts (`ERROR_API_TIMEOUT`) are handled centrally — `handleCommandError` surfaces the generic `PAX8_TIMEOUT_MS` env-var hint and `pax8 doctor` advice. If your command has a *domain-specific* workaround (e.g. `orders list` recommending `--size` / `--company` against the slow `/orders` endpoint, #199), catch the timeout, build a `CliError` via `timeoutRecoverySteps([yourHint])`, and re-throw — `timeoutRecoverySteps` concatenates the generic floor so the env-var escape hatch is always offered.
- Stack traces are never shown. If you need debugging detail, put it in `causes`.
- Exit code is always `1` on error, `0` on success. Don't use other codes.

**Per-request timeout.** Default `30000ms`. Partners on slow connections — or hitting a Pax8 endpoint that's known to be slow on their tenant — can override via `PAX8_TIMEOUT_MS=<ms>` (capped at `300000`). The env var is wired through `getDefaultTimeout()` in `@pax8/core` and applies to every API call; there is no per-command flag.

---

## 6. Pagination — 1-based for humans, 0-based for the API

The Pax8 API is 0-indexed; users expect 1-indexed. Translate at the boundary:

```ts
const userPage = parseInt(allOpts.page, 10);
const apiPage = Math.max(userPage - 1, 0);
const result = await ctx.api.companies.list({ page: apiPage, size: pageSize });
```

Default `--page` to `"1"` and `--size` to `"25"` in the option declaration.

### List-command envelope contract (#483)

Every `--json` list command — `clients list`, `subscriptions list`, `invoices list`, `invoices items`, `quotes list`, `contacts list`, `webhooks list`, `webhooks logs`, `webhooks topics list`, `products search`, `products list`, `usage list`, `recommendations list`, `subscriptions renewals`, `orders list` — emits a **wrapped envelope**:

```json
{
  "<resource>": [ ... ],
  "page": { "number": 1, "size": 25, "totalElements": 1810, "totalPages": 73 }
}
```

The resource key matches the resource name (`companies`, `subscriptions`, `invoices`, `items`, `quotes`, `contacts`, `webhooks`, `logs`, `topics`, `products`, `usage`, `renewals`, `orders`, `recommendations`). `page.number` is 1-based — matches what the user would pass as `--page` next. Compare `<resource>.length` to `page.totalElements` to detect pagination.

When `--with-actions` is passed, an additional `nextActions` array is added, including a next-page entry on portfolios that span multiple pages. The next-page entry's `command` is exactly what the user/agent would run to fetch the next page.

For endpoints that don't paginate server-side (webhooks list/logs/topics, usage, products search, subscriptions renewals), the helper `singlePageEnvelope(rowCount)` synthesizes a single-page envelope (`totalPages: 1`) so the shape stays consistent.

#### Table footer

Table output writes a one-line footer to **stderr** after the table:

```
  Page 1 of 73 — 1810 invoices — next: pax8 invoices list --page 2 --size 25
```

Suppress the `next:` segment on the last page. Use the helpers in `lib/output.ts`:

```ts
import {
  buildPageEnvelope,
  renderPaginationFooter,
  buildNextPageAction,
} from "../../lib/output.js";

const pageEnvelope = buildPageEnvelope(result.page);
const nextPageCommand = `pax8 <cmd> --page ${pageEnvelope.number + 1} --size ${pageEnvelope.size}`;

// JSON path:
process.stdout.write(JSON.stringify({ <resource>: result.content, page: pageEnvelope }, null, 2) + "\n");

// Table footer (stderr):
renderPaginationFooter(pageEnvelope, {
  resourceSingular: "invoice",
  nextPageCommand,
  rowCount: result.content.length,
});
```

#### Uncapped name enrichment

Lists that resolve a companion ID → name (most commonly company IDs) **must** use `buildCompanyNameMap()` from `lib/enrich-subscriptions.ts`, which pages through `companies.list` until every referenced ID is resolved or a 10×1000 guardrail trips. The pre-#483 `companies.list({ size: 200 })` pattern left blank cells for partners with more than 200 customers; never re-introduce it. For callers that need the full customer set (not just specific IDs), use `fetchAllCompanies(ctx)`.

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
  pax8 clients list
  pax8 clients list --status Active
  pax8 clients list --coverage
  pax8 clients list --json
  pax8 clients list --ids-only | xargs -I{} pax8 subscriptions list --company {}`)
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

## 12. Designing for agents

pax8-cli has two audiences. One is the human at a terminal. The other is an AI agent — `@pax8/claude-skill` already wraps every command as an LLM tool, and the CLI is also invoked directly by Claude Code via shell. **Treat agents as a peer audience.** A command that's good for humans but opaque to agents is half-finished.

Most rules above already serve agents (deterministic stdout, JSON default in non-TTY, structured errors via `CliError`, demo mode for safe experimentation). This section covers agent-specific contracts on top.

> **Status note:** items below are tagged **(implemented)** when the contract is live and enforced, or **(planned)** when it's policy intent — open an issue before relying on a planned contract. Don't add a new command that violates a planned contract; design with it in mind so the eventual rollout doesn't require a rewrite.

### Machine-readable error codes — (implemented)

Agents shouldn't have to regex-match English error strings to decide whether to retry, re-auth, or escalate. `CliError` carries a stable `code` field — a SCREAMING_SNAKE_CASE identifier like `ERROR_AUTH_EXPIRED`, `ERROR_COMPANY_NOT_FOUND`, `ERROR_RATE_LIMITED`, `ERROR_API_TIMEOUT`.

```ts
throw new CliError(
  "No company matched 'Acme'.",
  ["The name didn't match any active company."],
  [`Run ${replCmd("pax8 clients list")} to see active clients.`],
  "https://devx.pax8.com/",
  "ERROR_COMPANY_NOT_FOUND"
);
```

When `--json` is set, the error serializes to stderr as a structured object instead of formatted text:

```json
{
  "code": "ERROR_COMPANY_NOT_FOUND",
  "message": "No company matched 'Acme'.",
  "causes": ["..."],
  "recoverySteps": ["..."],
  "docsUrl": "https://devx.pax8.com/"
}
```

Codes live in `packages/core/src/errors/codes.ts` and are append-only — never repurpose an existing code, even for a "near-match" failure mode. If you need a new code, add a new constant.

### Idempotency keys for writes — (implemented, local-only in v0.1)

Write commands accept `--idempotency-key <uuid>` to mark retry intent. Today the **Pax8 API does not honor an `Idempotency-Key` request header** on `POST /orders` or other write endpoints, so the key is **not sent over the wire**. The CLI maintains a host-local replay cache: when you re-run the same command on the same host with the same key, the CLI returns the cached response instead of issuing a second API call.

```bash
pax8 orders create --company c1 --product p1 --quantity 5 \
  --idempotency-key 9f3b...e1
```

Local cache: 24h TTL, keyed on `{command, key, args-hash}`, stored under `~/.pax8/idempotency/`. When a key matches a cached call, the command writes `(idempotent replay)` to stderr (dim) and returns the cached response. Exit code is unchanged.

**Limitations to be honest about**:

- **Cross-process and cross-host retries are not deduped.** Two concurrent CLI invocations on different machines (or different `~/.pax8/` directories) with the same key both hit the API and both write. The local cache only protects same-host post-success replay.
- **Connection drops mid-write are not protected** — if the response is lost after the server processed the request but before the client cached the result, a retry creates a duplicate. Pair `--idempotency-key` with `pax8 orders show` / `pax8 subscriptions list --company` to verify state before retrying after any timeout/network failure.
- **v0.2 plan**: once Pax8 ships an `Idempotency-Key` header on write endpoints, the CLI will forward the key on the wire and the server will own deduplication. The local cache will downgrade to a fast-path response replay. Tracked in [#474](https://github.com/pax8labs/pax8-cli/issues/474).

New write commands should accept `--idempotency-key` for forward-compatibility and follow the `orders create` / `invoices dispute` pattern.

Reads never need a key.

### Out-of-band approval for agent-initiated writes — (planned)

An agent with valid OAuth credentials can place orders today. That's appropriate for low-stakes writes and inappropriate for anything a partner wants to lay eyes on first. The contract for high-stakes writes is **CIBA** — the OpenID Connect [Client-Initiated Backchannel Authentication Flow](https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html) — where the agent constructs the payload but a human signs it off out-of-band.

The flow:

1. Agent assembles the write (e.g. a `pax8 orders create` payload) and submits it for approval rather than execution.
2. Pax8's auth platform pushes an approval request to the partner's registered device — phone, hardware key, whatever's enrolled.
3. The partner reviews the *exact* payload (company, product, quantity, price) and approves or denies it.
4. On approval, the agent receives a token cryptographically scoped to that payload and submits the order with it. Mutating any field after sign-off invalidates the token — the agent cannot bait-and-switch.

Composes with idempotency keys: the approval token is one-shot (single submission). Same-host network-drop retries with the same `--idempotency-key` are deduped by the local replay cache (see above). Once the Pax8 API honors the `Idempotency-Key` header server-side ([#474](https://github.com/pax8labs/pax8-cli/issues/474)), the pair will give "approved exactly once, submitted at-least-once, deduped to exactly-once" across processes and hosts — until then, dedup is host-local.

Expect an **approval threshold** pattern: orders under a configurable dollar amount auto-approve via the standard `-y` / `--yes` flag; orders above the threshold require CIBA sign-off regardless of `--yes`. The threshold is partner-configured, not agent-configured.

Tracking issue: [#98](https://github.com/pax8labs/pax8-cli/issues/98). Don't ship an agent-initiated write path that bypasses this — design new write commands so a CIBA approval step can slot in without changing the command surface.

### Signal handling — (implemented)

A `SIGINT` (Ctrl+C) must not corrupt the terminal or leave a half-finished write in ambiguous state. The top-level handler:

1. **Stops active spinners cleanly** — clears the line, doesn't `.fail()` (that prints `✗` which reads like an error).
2. **If a write is in flight,** logs `(cancelled)` to stderr with the idempotency key (if any) so the user can resume or investigate.
3. **Exits with code 130** — the conventional SIGINT exit code. Not 1.

Reads can be killed without ceremony. Writes log enough context that a follow-up `pax8 orders show` or `subscriptions show` can confirm the actual state.

### Next-action hints — (implementing)

Every workflow that returns a list or summary should tell the agent — and the human — what to run next. The contract is the same shape everywhere:

```json
{
  "command": "pax8 recommendations act --company \"Acme Corp\"",
  "description": "Walk through and order the open recommendations for Acme Corp"
}
```

- `command` is a runnable shell snippet. No prose, no placeholders the agent has to fill in beyond what's already in the JSON. If the command needs an argument that came from the response, embed it (with proper quoting).
- `description` is one short sentence — enough for an agent or human to decide whether to follow it.

Two delivery modes, depending on the response shape:

| Response shape | Where `nextActions` lives | Flag |
|---|---|---|
| Single object (`dashboard`, `invoices audit`) | Inline as a top-level `nextActions` field | Always emitted |
| List/array (`companies list`, `subscriptions list`, `subscriptions renewals`, `recommendations list`, `invoices list`, `webhooks list`, `webhooks logs`) | Inside an envelope: `{ <resourceKey>: [...], nextActions: [...] }` | Opt-in via `--with-actions` |

The opt-in flag for list commands exists because the default contract is "list commands return a flat array" — agents that already parse `pax8 ... list --json` as an array of records don't break. If they want hints, they pass `--with-actions` and accept the wrapped envelope.

The resource key inside the envelope matches the resource name (`companies`, `subscriptions`, `renewals`, `recommendations`, `webhooks`, `logs`, `invoices`). Diagnostic siblings (e.g. `unmatchedProducts` on recommendations) ride alongside `nextActions`.

**The rule:** every command that lists resources or summarizes state populates `nextActions` — inline for single-object summaries, behind `--with-actions` for arrays. Cap the array at five entries and rank by likely usefulness; an agent reading the list top-to-bottom should hit the highest-leverage next step first.

Detail commands (`<resource> show <id>`) don't need `nextActions` — the agent already knows what they're looking at. Write commands (`create`, `update`, `cancel`) can include them in their single-object response when there's an obvious follow-up (e.g. `orders create` → `pax8 orders show <new-id>`).

### Stable list ordering — (implemented where the API permits)

Agents that crawl paginated lists expect order to be stable across calls. Where the Pax8 API guarantees order (most list endpoints sort by `createdDate desc`), surface results unchanged. Where the API doesn't guarantee order, sort by `id` ascending in the CLI before output, so `list --page 1` followed by `list --page 2` doesn't double-count or skip rows.

If you add a new list command and the sort order isn't obvious from the API docs, document it in the command's examples block: `# results sorted by createdDate desc`.

---

## 13. Checklist for a new command

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
- [ ] If the command returns a list or summary, populates `nextActions` — inline for single-object responses, behind `--with-actions` (`{ <resource>: [...], nextActions: [...] }`) for list responses. See §12.
- [ ] Subprocess test in `packages/cli/src/__tests__/` covers TTY format, `--json`, and an error path.
- [ ] Output is byte-stable: no timestamps or random IDs in the rendered output unless they came from the (mock) API.
- [ ] Reviewed §12 ("Designing for agents") — if the command writes, has new error modes, or returns lists, confirm it conforms to the agent contracts (implemented and planned).
