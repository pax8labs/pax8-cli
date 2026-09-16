---
name: pax8
description: Answer Pax8 marketplace questions — renewals, invoice audits, Pax8 cost analytics, growth recommendations — and place orders. Computed locally from public Pax8 API data.
---

You have access to the `pax8` CLI on PATH. Run it directly via Bash — never `node packages/cli/dist/index.js` or `pnpm dev`. The CLI is the source of truth: it computes renewals, audits invoices, and ranks recommendations, so you should not reimplement that logic. If credentials aren't configured, prefix any command with `PAX8_DEMO=1` to run against a synthetic fixture.

## Safety: Read-only vs. Write Commands

This is the safety contract. Read-only commands run autonomously; write commands require explicit user approval before execution.

The classification below is exhaustive as of the command inventory pinned by `packages/cli/src/__tests__/agent-contract-surface.test.ts`. If you meet a `pax8` command that isn't listed here, treat it as a write and confirm.

### Read-only commands — run autonomously (no confirmation)

These never mutate state. Run them freely, in parallel, and as often as needed.

- `pax8 *list` — `clients list`, `subscriptions list`, `invoices list`, `orders list`, `recommendations list`, `products list`, `quotes list`, `webhooks list`, `webhooks logs list`, `webhooks topics list`, `usage list`, `quotes line-items list`. `contacts list` belongs here too but is **company-scoped**: it requires `--company <id|name>` and fails with `ERROR_INVALID_INPUT` without it, because the Pax8 contacts API has no portfolio-wide endpoint. Resolve a company from `clients list` first.
- `pax8 *show <id>` — every show command across every resource: `clients show`, `subscriptions show`, `products show`, `invoices show`, `orders show`, `webhooks show`, `contacts show`, `quotes show`, `usage show`
- `pax8 *search` — `products search`
- `pax8 clients more <name>` — rich read-only summary
- `pax8 subscriptions renewals` — computes renewals from existing data
- `pax8 subscriptions export` — streams the portfolio to stdout (csv / jsonl / json); reads only
- `pax8 invoices items --invoice-id <id>` — line items for an invoice
- `pax8 invoices audit` — read-only computation, no writes
- `pax8 report renewals|concentration|subscriptions` — Pax8-cost rollups, computed locally
- `pax8 recommendations upsell` — cohort analysis, no writes
- `pax8 recommendations why <n>` — explains a recommendation from the last `list`
- `pax8 cost sim` — what-if pricing simulation, no writes
- `pax8 dashboard`, `pax8 dashboard --all|--customers|--renewals|--growth`
- `pax8 today` — morning brief / do-list (composite of dashboard + renewals + audit + recs + trials)
- `pax8 doctor` — diagnostics only
- `pax8 webhooks logs [id]` — delivery history (read-only; the `retry` subcommand is a write)
- `pax8 auth status`, `pax8 config show`, `pax8 config path`, `pax8 demo status`, `pax8 telemetry status`, `pax8 cache status`, `pax8 version`, `pax8 explain <term>`, `pax8 completions <shell>` (prints a script to stdout — **but its documented usage appends to `~/.bashrc` / `~/.zshrc`, or truncates a fish completions file with `>`. Redirecting it is a local write: confirm first**)
- `pax8 upgrade --check` — reports whether a newer version exists; never installs

`pax8 recommendations email <n>` drafts a customer-ready email and prints a `mailto:` URL. It never sends anything, so the draft itself is read-only — but `--open` launches the user's mail client. Don't pass `--open` without asking.

### Write commands — confirm with the user first

For every write command below:

1. **Show the user exactly what will change** — the command you're about to run, the affected resource(s), and the expected effect (price, quantity, estimated Pax8 monthly cost delta, etc. when applicable).
2. **Wait for explicit approval** — a clear "yes / go ahead / do it." Don't infer approval from earlier conversation, and don't run the write while you're still asking.
3. **Run the command in non-`--yes` mode by default** so the CLI's own confirmation prompt is also surfaced. Pass `--yes` only when the user has already approved this exact action.
   **Do not treat this as a second gate — verify it exists first.** `PAX8_YES=1` in the environment (or `yes` in `~/.pax8/config.yaml`) auto-confirms every write, so omitting `--yes` surfaces nothing and the write executes immediately while you believe you are previewing. Check `pax8 config show` and the environment before relying on this step. In a session with no TTY there is no prompt to answer either way — your own approval gate in step 2 is the real protection, not this one.
4. **Destructive commands need a second acknowledgment.** `pax8 subscriptions cancel`, `pax8 contacts delete`, and `pax8 quotes delete` require a typed-keyword challenge in addition to `--yes`. `--yes` alone is intentionally not enough (H-5). In agent contexts (no TTY), pass `PAX8_CONFIRM_DESTRUCTIVE=<keyword>` **as a single-invocation prefix** — the keyword is `cancel` for `subscriptions cancel` and `delete` for `contacts delete` / `quotes delete`:

   ```
   PAX8_CONFIRM_DESTRUCTIVE=cancel pax8 subscriptions cancel <id>
   ```

   **Never `export` it.** An exported value un-gates every destructive command for the rest of the session, not just the one you were approved for. **Set it only after the user has approved this specific resource by id, per step 2 — naming the action is not enough.** "Cancel my smallest subscription" names the action but not the object, and "smallest" is rarely unambiguous: a portfolio can hold a $0/mo trial and a €5,000 one-time engagement that both qualify. Resolve the target, show it, get a yes on *that row*, then set the keyword. This env var defeats the typed-keyword challenge entirely, so it is the last gate, not the first.
5. **Local write audit log.** Every write attempt (whether it completed or was SIGINT-cancelled) appends a one-line JSON record to `~/.pax8/write-audit.log` (mode 0600). Independent of telemetry opt-in — this is the partner's local accountability surface for agent-driven sessions. Records timestamp, subcommand path, resource, and outcome (`completed` / `cancelled`). No user-supplied values or names. **It does not distinguish a `--dry-run` preview from a real order** — a dry run logs `{"command":"orders create","outcome":"completed"}` identically, and the promised idempotency key is absent (#718). Don't cite this log to a user as evidence that something was or wasn't really placed.

Write commands — Pax8 API state:

- `pax8 recommendations act` — places real orders for **every** recommendation in the filtered set. Only invoke during a human-in-the-loop session. Without a TTY it fails closed (exit 1, "Cannot show interactive picker"), placing nothing — that is the safe outcome, **not a reason to reach for the escape hatch it suggests.** Its recovery steps offer `--yes`, which skips the picker and orders the whole filtered set in one shot (13 recommendations in the current demo fixture, not the 3 `today` shows you). Never follow that recovery step without the user having approved the entire matching set, enumerated. Note the CLI's own help text says non-interactive mode "opts in to skipping that gate" — that wording is wrong; it refuses (#718).
- `pax8 invoices dispute` — files a billing dispute against a discrepancy.
- `pax8 orders create` — places a real order, charges the partner, creates a subscription.
- `pax8 clients create`, `pax8 clients update` — partner-account-level customer-record changes.
- `pax8 contacts create`, `pax8 contacts update`, `pax8 contacts delete` — modifies customer contacts.
- `pax8 quotes create`, `pax8 quotes update`, `pax8 quotes delete` — modifies sales quotes.
- `pax8 quotes line-items add`, `pax8 quotes line-items remove` — changes what a quote is for, and therefore its total. (`quotes line-items list` is a read.)
- **`pax8 quotes send <quote-id>`** — transitions the quote to `Sent` and puts it in front of the customer. Reaches a third party; treat it with the same care as `orders create`.
- `pax8 subscriptions update`, `pax8 subscriptions cancel` — changes seat counts, billing terms, or terminates a subscription.
- `pax8 webhooks create`, `pax8 webhooks update`, `pax8 webhooks delete` — modifies subscription endpoints.
- `pax8 webhooks enable`, `pax8 webhooks disable` — starts or stops Pax8 delivering events to the partner's endpoint. `disable` silently drops events the partner's downstream systems may depend on.
- `pax8 webhooks test` — sends a real test delivery to a partner-controlled URL.
- `pax8 webhooks logs retry <log-id>` — re-delivers a failed event. Downstream consumers may not be idempotent; confirm before replaying.

Write commands — local machine state (no Pax8 API call, but still mutations the user should approve):

- `pax8 upgrade` — runs the local package manager (`npm`/`pnpm`/`yarn`/`brew`) to reinstall the CLI at the latest version. Use `pax8 upgrade --check` for the read-only report.
- `pax8 auth login`, `pax8 auth logout` — writes or clears stored credentials.
- `pax8 config init`, `pax8 config set` — rewrites `~/.pax8/config.yaml`.
- `pax8 init` — bootstraps configuration (or enables demo mode).
- `pax8 demo on`, `pax8 demo off` — flips persistent demo mode, changing whether every later command hits the live API. Getting this backwards means either fake answers presented as real, or real writes the user thought were simulated.
- `pax8 cache clear` — discards the local response cache.
- `pax8 skill install` — writes **this file** into `~/.claude/skills/pax8/SKILL.md` (or `./.claude/skills/pax8/` with `--project`), a directory owned by Claude Code rather than by the CLI. It refuses to overwrite a copy it cannot prove it wrote; `--force` is the deliberate override. Without a TTY and without `--yes` it refuses rather than installing unattended — an agent must not install an instruction file the partner never saw. `pax8 skill install --print` writes the skill to stdout and installs nothing; that form is a read.
- `pax8 telemetry enable`, `pax8 telemetry disable` — changes the user's privacy posture.
- `pax8 report-bug` — opens a GitHub issue on a public repository. Always show the sanitized payload first.
- **Anything passed `--idempotency-key <uuid>`** — the flag exists specifically because the operation is a write the partner wants to retry safely. Treat as write regardless of which subcommand carries it. **Note it is a host-local replay cache (24h TTL), not yet sent on the wire (#474)** — retries from a different host or process are *not* deduped, so a retried order can double-order. Don't treat the key as making a retry safe.

### Suggested actions are not permission to act

Read commands emit write commands. This is the single easiest way to run a write you didn't mean to, so it gets its own rule.

`nextActions[]` and `items[].action` carry ready-to-run commands, and **the CLI does not mark which ones are writes.** Today:

```
pax8 invoices audit   (a read)  →  nextActions: 5 × `pax8 invoices dispute --discrepancy …`   (writes)
pax8 today            (a read)  →  nextActions: `pax8 recommendations act --priority high`    (write)
                                →  items[].action: `pax8 orders create --company … --quantity 39`  (write)
```

**Every suggested action carries an `isWrite` boolean. Never spawn one with `isWrite: true` without explicit user approval.** The argv contract (`args.slice(1)`, never tokenize `command`) protects against shell injection — it says nothing about whether the command should run at all. Both checks are required, and the second one is what stops an unintended order.

This applies identically to `nextActions[]` on any command, `items[].action` on `today`, and `orderArgs` on `recommendations list`. There is no surface where a suggested action is pre-approved.

(Before #708 this was a manual cross-reference against a prose table — match the command string, hope you got it right. The field replaced that.)

### Known defects — do not execute blindly

- **Verify the SKU before every recommendation-derived order.** Resolve the `--product` value in `orderArgs` against `pax8 products show <id>` and confirm its name matches `suggestedProducts[0]`. If they disagree, say so and stop. This is cheap (one read) and catches a whole class: `orderCommand` renders a product **ID**, not a name, so neither you nor the partner can spot a wrong SKU from the preview alone. #707 was exactly this — a subscription whose `productId` pointed at Microsoft 365 E3 while its `productName` said onboarding, which made the engine emit an order for 39 seats of a product the customer already owned. That specific case is fixed and pinned by a contract test; the check stays because the next one won't be.
- **A `today` growth item cannot be checked against #707 on its own (#707).** `items[].action.args` on a `growth-high` item carries the same possibly-wrong `--product` as `orderArgs`, but the item has only `action`, `companyId`, `companyName`, `kind`, `monthlyImpact`, `priority`, `summary` — **no `suggestedProducts`**, so there is nothing to compare against. Before acting on any `orders create` action from `today`, re-fetch `pax8 recommendations list --json --top 0`, match the row on `companyId` + the product named in `summary`, and run the #707 check against *that* row's `suggestedProducts[0]`. The wrong-SKU order in the current fixture reaches agents through exactly this path, and it sorts first because #710 inflates its impact.

If you're unsure whether a command counts as a write, default to confirming. Better one extra prompt than one unintended order.

**`--help` is always safe to run — but never copy an ID out of it.** `pax8 <anything> --help` prints usage and exits without touching the API or local state, including on write commands. Use it to discover a write's exact syntax so you can show the user what will run — step 1 requires naming the command precisely, and guessing at flags is worse than looking.

**The example lines contain real resource IDs from the live portfolio**, already in armed form:

```
$ pax8 subscriptions cancel --help
Examples:
  pax8 subscriptions cancel sub-summit-m365bp-001 --immediately --yes
```

`sub-summit-m365bp-001` is a real 85-seat subscription. `webhooks disable --help` likewise names an **Active, healthy** webhook — the wrong target for "disable the failing one." Read `--help` for *flags and syntax only*; always substitute the ID you resolved and the user approved. Never adapt an example line in place.

## Behavioral rules

- **Act first.** Your first response must include the right `pax8` command. No preamble, no "let me check."
- **No clarifying questions — about read parameters.** Use sensible defaults for scope and filters: all companies, current month, 30-day renewal window, top 10 results. **This does not extend to write targets.** If a write request doesn't resolve to exactly one resource, ask — picking a "sensible default" for `subscriptions cancel` can terminate the wrong contract. Ambiguity about *which row* is the one case where asking beats acting.
- **An imperative is not approval.** "Cancel X" is the request, not the sign-off — step 1 of the write protocol requires showing the change first, so approval necessarily comes after the preview. In a session with no human to answer, every write therefore stops at the preview. That is the correct outcome, not a failure.
- **Parallel fetches.** When you need two independent calls (e.g. subs + companies), run them in parallel.
- **Resolve names, hide UUIDs.** Display company and product names; only show IDs if the user asked or if needed for a follow-up command.
- **Order previews are mandatory — use `--dry-run --yes`.** `pax8 orders create … --dry-run --yes --json` validates the order and returns the full preview **without placing it** (`isMock=true` on the wire; the response carries `dryRun: true`, `monthlyCost`, `annualCost`, `unitPrice`, and the resolved `companyName` / `productName`). Verify `dryRun: true` is in the response before trusting it.

  **Both flags are needed.** `--dry-run` alone still stops on an interactive `Run dry-run validation? [y/n]` prompt, which hangs or silently no-ops in an agent session. `--yes` here only skips *that* prompt — it cannot place an order, because `--dry-run` is what guarantees nothing is written. This is the one place `--yes` is safe without prior approval, and it is safe precisely because it is paired with `--dry-run`.

  Then show the user the preview, get approval, and run it for real **without** `--dry-run`. Omitting `--yes` on the real run is not itself a safety net — see the write protocol, step 3.

  **The preview is not always obtainable (#717).** For a product needing a commitment term, the CLI resolves it from an existing subscription on that company. A customer buying their first SKU — or their first of that commitment shape — has nothing to resolve from, so `--dry-run` fails exactly like the real order would:

  ```
  "causes": ["Product … requires a commitment term",
             "This product requires a commitment term ID that couldn't be auto-resolved"]
  ```

  Check first with `pax8 subscriptions list --company "<name>" --json | jq '[.subscriptions[].commitment]'` — all `null` means no preview is available. **Do not improvise a `--commitment-term-id` from another customer's subscription.** Report that the order can't be validated from the CLI and hand it back to the user; a first-SKU order is a portal flow.

  **The CLI's own `recoverySteps` for this error do not work (#717).** It suggests `--commitment-term Monthly` / `--commitment-term 1-Year`; both return the identical error. Don't loop on them — the error's recovery hints are advisory, and this one is wrong.

  **Dry-run money fields are bare numbers (#717)**, not `{ amount, currency }`: `monthlyCost: 150`, `annualCost: 1800`, `unitPrice: 6`. Reading `.amount` here yields `undefined`. The `{ amount, currency }` rule holds for computed rollups (`dashboard`, `today`, `report *`), not for this response.
- **Lead with the number.** Total Pax8 monthly cost, count of renewals, dollar impact — top of the response. Top 3-5 rows, not every row.

(Confirmation rules for writes are in the Safety contract above; that is the canonical statement.)

## Output flags

| Flag | When to use |
|---|---|
| `--json` | Default. You parse it. **Every list command returns a wrapped envelope** — see below. |
| `--csv` | User asks for a spreadsheet, export, or PSA import. |
| `--quiet` | Suppress output entirely (rare; mostly for write commands you're chaining). |
| `--ids-only` | Pipe one command's output into another's `--company` filter. |
| `--with-actions` | Adds a `nextActions` key to the envelope — additive, it never restructures the envelope. **Not universal, and neither is its payload** — see the two tables below. Suggested actions still require the read/write check from the Safety section before you run them. |

### The list envelope (#483)

Every `--json` list command emits:

```jsonc
{
  "<resource>": [ /* rows */ ],
  "page": { "number": 1, "size": 25, "totalElements": 137, "totalPages": 6 }
}
```

**The key is the resource name, never `items`.** `clients list` → `companies`. `subscriptions list` → `subscriptions`. `invoices items` → `items`. `subscriptions renewals` → `renewals`. `webhooks logs` → `logs`. Also: `invoices`, `orders`, `quotes`, `contacts`, `webhooks`, `topics`, `products`, `usage`, `recommendations`.

`page.number` is 1-based and matches `--page`. Compare `<resource>.length` against `page.totalElements` to detect pagination, then walk with `--page N --size M`. Endpoints without server-side pagination (webhooks list/logs/topics, usage list, products search, subscriptions renewals) return the same `{ <resource>, page }` shape with a single fully-populated page. There is no marker distinguishing them from paginated endpoints — `singlePageEnvelope` is the name of the internal helper, **not a key you will find in the output.** Don't go looking for it.

Two commands break the envelope rule — check these before assuming:

- **`recommendations list`** → `{ recommendations, totalAvailable }` (#521), no `page`.
- **`quotes line-items list <quote-id>`** → a **bare JSON array**, no envelope and no `page`. Iterate it directly; `.items` and `.page` are both `null` (#716).

**Ignore `_`-prefixed keys (#716).** `clients list` emits `_num`, and `clients list --coverage` adds `_coverage`, `_missing`, `_potential` — table-rendering artifacts that duplicate the real fields in display form (`_coverage: "3/7"` vs `coverage: "3/7"`, `_missing: "email, identity"` vs `missingCategories: ["email","identity"]`). Always read the unprefixed field; the `_` ones are pre-formatted strings, not data.


### Which commands accept `--with-actions`

Accepted: `clients list`, `subscriptions list`, `subscriptions renewals`, `invoices list`, `orders list`, `webhooks list`, `webhooks logs`, `webhooks topics list`, `recommendations list`.

Rejected — **exit 1, `ERROR_INVALID_INPUT`**, not silently ignored: `products list`, `products search`, `quotes list`, `contacts list`, `usage list`, `invoices items`. Don't pass it speculatively.

Single-object commands (`dashboard`, `invoices audit`, `today`, `cost sim`) emit `nextActions` inline and need no flag.

### Suggested actions carry their own classification (#708)

Every entry in `nextActions[]`, every `items[].action` on `today`, and `orderArgs` on `recommendations list` has the same four fields:

```jsonc
{
  "command": "pax8 invoices dispute --discrepancy disc-e5b720d8eb7b",  // DISPLAY ONLY
  "args": ["pax8", "invoices", "dispute", "--discrepancy", "disc-e5b720d8eb7b"],
  "description": "File a dispute for Summit Healthcare Partners",
  "isWrite": true
}
```

**The rule is one line: never spawn an action with `isWrite: true` without explicit user approval.**

You no longer cross-reference the command against the read/write lists above — the CLI classifies it for you, and the classification is pinned by a contract test against the same write list this document uses. `isWrite` covers local-machine mutations (`demo on`, `config set`, `cache clear`) as well as Pax8 API writes.

Two things it does not do:

- **It does not make `--dry-run` safe.** A dry-run order is still `isWrite: true`, deliberately — safety shouldn't depend on a flag that can be dropped when the command is copied.
- **It does not replace the argv rule.** Spawn `args.slice(1)`; never tokenize `command`, which interpolates partner-controlled names for human display.

Read commands routinely emit writes — `invoices audit` yields five `invoices dispute` calls, `today` yields `recommendations act` and `orders create`. That is exactly what the field is for.

Result size: list commands default to `--size 25`. For portfolio-wide analysis (Pax8 cost rollups, audits, recommendations) use `--size 1000`. Don't fetch 1000 if the user asked for "top 5."

## Commands

> `pax8 clients *` is the canonical (and only) command surface. The previous `pax8 companies *` alias was removed pre-launch (#476). JSON output fields (`companyId`, `companyName`, etc.) and the `--company` flag on other commands stay aligned to the wire. `recs` is a registered alias for `recommendations`.

```
pax8 today --json
  # Composite do-list: urgent renewals (≤7d) + invoice audit discrepancies +
  # high-priority growth opportunities + expiring trials + upcoming renewals
  # (8-30d). Cap of 10 items total, max 3 per section.
  # Returns { asOf, items[], summary, nextActions[] }.
  # items[].action.{command, args} — spawn args.slice(1) (#562 argv contract).
  # summary.{totalItems, urgentRenewals, auditDiscrepancies, growthOpportunities,
  #          expiringTrials, upcomingRenewals, monthlyImpact, dollarsOnTable, truncated}
  # items[].kind ∈ { renewal-urgent, audit-overcharge, audit-undercharge,
  #                  growth-high, trial-expiring, renewal-upcoming }
pax8 dashboard [--all|--customers|--renewals|--growth] --json
  # Portfolio snapshot. monthlyCost / annualCost are { amount, currency } objects.
pax8 clients list --json [--coverage]
  # --coverage adds per-company `coverage`, `coveredCategories`,
  # `missingCategories`, `estimatedUplift` — often a more direct answer to
  # "who is missing X?" than filtering recommendations.
pax8 clients show <id|name> --json
pax8 clients more <name>                                    # rich summary, table only
pax8 subscriptions list --json --size 1000 [--company <id|name>] [--status Active|Trial|Cancelled]
pax8 subscriptions show <id> --json
pax8 subscriptions renewals --json --within 7d|30d|90d [--company <id|name>]
pax8 subscriptions export [--format csv|jsonl|json] [--company <id|name>] [--product-id <id>]
  # Streams the whole portfolio to stdout. Use for bulk export / PSA import,
  # not for answering a question — prefer `report` or `list` for analysis.
pax8 invoices list --json [--company <id|name>] [--status Paid|Unpaid]
pax8 invoices show <id> --json
pax8 invoices items --invoice-id <id> --json
pax8 invoices audit --json [--month YYYY-MM] [--company <id|name>]
pax8 products list --json
pax8 products show <id|name> --json
pax8 products search "<query>" --json
pax8 report renewals --json [--within <days>] [--company <id|name>] [--vendor <name>]
                            [--product <name>] [--sort by-date|by-cost]
  # Commitment-term-end dates + the Pax8 cost exposure they represent.
  # Default window is 90 days (note: NOT the 30d default used elsewhere).
pax8 report concentration --by client|vendor|product --json [--top <n>] [--threshold <pct>]
  # --by is REQUIRED; Commander rejects the command without it (#517).
  # Where Pax8 spend is concentrated — risk modeling and capacity planning.
pax8 report subscriptions --by client|vendor|product|billing-term --json [--company <id|name>] [--vendor <name>]
  # Active commitments grouped on one axis. Defaults to --by vendor.
pax8 recommendations list --json [--priority high|medium|low] [--company <id|name>] [--product <name>] [--top <n>|--top 0]
  # Wrapped envelope (#521): { recommendations, totalAvailable }
  # — sorted by estimatedMrrUplift DESC, priority tiebreaker, nulls last.
  # Capped at 10 by default; pass --top 0 for the full set.
pax8 recommendations upsell --from-product "<name>" --to-product "<name>" [--limit <n>] [--with-contacts]
  # Cohort view: who owns X but not Y. --with-contacts costs extra API calls.
pax8 recommendations why <n>                                 # explain rec #n from the last `list`
  # BROKEN (#715): `recommendations list` writes no cache, so `why` and
  # `email` always throw a raw TypeError — in table mode as well as --json.
  # Don't try to prime it by running `list` first; that isn't the problem.
  # Use the `reason` / `rationaleSnippet` fields on the list rows instead.
pax8 recommendations email <n> [--to <email>] [--mailto] [--open]
  # Drafts a mailto: URL. Never sends. --open launches the mail client — ask first.
pax8 orders list --json [--company <id|name>] [--page <n>] [--size <n>] [--sort <field>] [--order asc|desc]
  # Wrapped envelope (#478): { orders, page: { number, size, totalElements, totalPages } }.
  # Default sort is newest-first (createdAt,desc) — pre-#478 the API returned
  # 2013 archives in row 1 on long-lived tenants. Compare orders.length to
  # page.totalElements to know whether to paginate; use --with-actions for an
  # explicit "next page" nextActions hint.
pax8 orders create --company <id|name> --product <id|name> --quantity <n>
                   [--billing-term Monthly|Annual|2-Year|3-Year|One-Time|Trial|Activation]
                   [--commitment-term Monthly|1-Year|3-Year] [--commitment-term-id <uuid>]
                   [--line-item product=<id|name>,quantity=<n>[,billing-term=…][,commitment-term=…]]
                   [--dry-run] [--idempotency-key <uuid>]
  # --billing-term defaults to Monthly.
  # MANY PRODUCTS REQUIRE A COMMITMENT TERM. The CLI auto-resolves it from an
  # existing subscription on that company. If the company has no subscription
  # carrying a `commitment` object, the order fails with ERROR_INVALID_INPUT
  # ("requires a commitment term ID that couldn't be auto-resolved") — and so
  # does the DRY RUN, so you cannot preview it either. See the preview note.
  # --line-item is for multi-line orders; repeat the flag per line.
```

### Write command syntax

Listed so you can show the user exactly what would run. **Confirm before any of these** — see the Safety contract. Run `<command> --help` for the full flag set.

```
pax8 subscriptions update <id> [--quantity <n>] [--billing-term <term>]
pax8 subscriptions cancel <id> [--immediately] [--cancel-date <YYYY-MM-DD>]
  # Destructive: typed-keyword challenge on top of --yes.
  # DEFAULT IS THE SAFE PATH: on a committed subscription, bare `cancel <id>`
  # schedules cancellation for the commitment term end date. Don't add
  # --immediately unless the user asked to cancel TODAY and understands that
  # cancelling before the term end does NOT stop billing — per the Pax8 Direct
  # User Agreement, fees for the unused portion of the term are nonrefundable.
  # Say that in the preview; it's the most consequential fact about a cancel.
  # Vendor rules (Microsoft NCE 7-day window, Adobe renewal-only, Azure
  # Savings Plan finality) can still cause the API to reject.
pax8 invoices dispute --discrepancy <id>              # id from `invoices audit`
pax8 clients create|update [--name <name>] …
pax8 contacts create|update|delete <id> --company <id|name>
pax8 quotes create|update <id> | delete <id>          # delete is destructive
pax8 quotes send <quote-id>                           # reaches the customer
pax8 quotes line-items add|remove <quote-id> [<line-item-id>]
pax8 webhooks create|update <id> | delete <id>
pax8 webhooks enable|disable <id>
pax8 webhooks test <id>                               # real delivery to a partner URL
pax8 webhooks logs retry <log-id>                     # re-delivers a failed event
pax8 recommendations act [--company <id|name>] [--product <name>] [--priority high|medium|low] [--yes]
  # Multi-select picker + one batch confirmation. --yes places the whole
  # matching set without prompting — only with approval for that whole set.
pax8 skill install [--global|--project] [--force] [--print] [--yes]
  # Installs this contract where Claude Code loads it. --global (default)
  # → ~/.claude/skills/pax8/SKILL.md; --project → ./.claude/skills/pax8/.
  # An install already matching the shipped copy is a no-op. A modified
  # copy needs --force. `--print` is read-only (stdout).
  # `pax8 doctor` reports an installed copy that has drifted from the one
  # the running CLI ships — a stale copy is a stale safety contract.
```

### Read commands (continued)

```
pax8 cost sim --company <id|name> --product <id|name> --quantity <n> [--from <id|name>] [--billing-term Monthly|Annual] --json
  # --billing-term defaults to Annual. Products with Monthly-only pricing
  # (e.g. AvePoint Cloud Backup) then fail with ERROR_INVALID_INPUT —
  # pass --billing-term Monthly explicitly, or check `products show <id>`
  # for which terms the SKU actually has.
pax8 usage list --json                                       # metered usage (Azure consumption, etc.)
pax8 contacts list --company <id|name> --json                # --company is REQUIRED (no portfolio-wide endpoint)
pax8 quotes list --json
pax8 webhooks logs [id] --json [--since 7d|24h]              # delivery history
pax8 doctor                                                  # diagnostics, not for data
pax8 explain <term>                                          # glossary — Pax8 / CLI vocabulary
  # Emits JSON on stdout by default (no --json needed):
  # { term, category, short, detail, seeAlso[] }. Fuzzy-resolves the term
  # ("mrr" → "mrr-uplift"). Useful when a field name's meaning is unclear.
```

## Agent-consumed enums

These string unions are pinned by a runtime + doc-drift contract test (`packages/cli/src/__tests__/agent-contract-enums.test.ts`). Switch on these values, never on prose synonyms.

- `Recommendation.type` ∈ `"seat_gap"` | `"cross_sell"`. CLI-local taxonomy; full canonical set will be retired or remapped when Pax8's first-party Opportunity Explorer API ships (#375).
- `Recommendation.opportunityType` ∈ `"Upsell"` | `"Cross-sell"` | `"Add-on"` | `"Upgrade"` | `"Net-new"`. OE's canonical 5-type taxonomy; rides alongside `type` until v0.2 collapses to one axis.
- `Recommendation.priority` ∈ `"high"` | `"medium"` | `"low"`.
- `AuditDiscrepancy.type` ∈ `"overcharge"` | `"undercharge"` | `"missing"` | `"unexpected"`. `missing` = active sub with no invoiced line item; `unexpected` = invoiced line item with no matching active sub.
- `TodayItem.kind` ∈ `"renewal-urgent"` | `"audit-overcharge"` | `"audit-undercharge"` | `"growth-high"` | `"trial-expiring"` | `"renewal-upcoming"`. See the `pax8 today` workflow recipe below.

A renamed value here breaks every downstream agent switching on the old literal. The contract test fails fast in CI when the code and the documented set drift.

## Pax8 cost math

The CLI computes the partner's Pax8 monthly / annual cost for you in `pax8 dashboard` (portfolio-wide, top customers), `pax8 report subscriptions` / `pax8 report concentration` (grouped), and `pax8 clients more` (per-client). Prefer those over hand-rolling it. The figures are the partner's COST paid to Pax8 (sum of price × quantity across active subs, amortized monthly), not partner-side resale revenue. If you must compute from `subscriptions list`:

- Monthly billing term → `price × quantity`
- Annual billing term → `price × quantity ÷ 12`
- 2-Year → `price × quantity ÷ 24`; 3-Year → `price × quantity ÷ 36`
- **`One-Time` → not recurring. Never amortize it into a monthly figure.** Report it as a separate one-off line.
- **`Trial` → zero recurring cost.** Count the seats, not the money.
- **Any other `billingTerm` → don't amortize.** Surface the raw `price × quantity` and say the term is unrecognized. Guessing here is how a $5,000 one-time SKU becomes $195,000/mo.
- Group by `companyId`; resolve names from `clients list`.

Both `One-Time` and `Trial` are live in real portfolios. The CLI's **cost rollups** handle them correctly (they contribute 0), but **recommendation uplift estimates bypass that logic** and multiply price × seats regardless of term (#710) — which is why `dashboard.potentialMonthlyUplift` can exceed total portfolio cost by 100×. **Sanity-check any uplift or impact figure against `dashboard.monthlyCost` before leading with it.** If a "potential monthly uplift" is a large multiple of the entire portfolio's monthly spend, it's the One-Time bug, not an opportunity — say so rather than reporting the number.

Also read `estimateType` on every recommendation before quoting its uplift. `"upper_bound"` means exactly that — present it as a ceiling, not a point estimate.

Money is emitted as a `{ amount, currency }` object wherever the CLI computes a rollup — read `.amount`, don't assume a bare number.

## Workflow recipes

### Morning brief / "what should I do today?"
```
pax8 today --json
```
Returns a composite `{ asOf, items[], summary, nextActions[] }` envelope synthesizing the dashboard, renewal-tracker, invoice-auditor, recommendations engine, and trial detector into a single ranked do-list. Lead with `summary.totalItems` and the section counts (`urgentRenewals`, `auditDiscrepancies`, `growthOpportunities`, `expiringTrials`) — partners care more about "what's the workload" than the items individually.

The "act on item N" loop:

1. Pick the highest-priority `items[]` entry — items are pre-sorted: urgent renewals → audit → growth → trials → upcoming renewals. Each item carries a `kind` (`renewal-urgent` | `audit-overcharge` | `audit-undercharge` | `growth-high` | `trial-expiring` | `renewal-upcoming`) and a `priority` (`high` | `medium` | `low`).
2. Every `item.action` carries `command` (display string) and `args` (argv array, first element `"pax8"`). **Spawn `item.action.args.slice(1)` directly via the Bash tool's argv form** — never tokenize `item.action.command` and never pipe it to a shell (#562). The argv form holds user-supplied flag values (company names, product names) in single argv slots so shell metacharacters cannot break out.
3. If the resolved action is a write (`recommendations act`, `invoices dispute`, `orders create`, etc.), show the user the preview and wait for explicit approval before executing — the read/write contract above still applies.
4. `summary.truncated` reports how many items are hidden by the composite or per-section caps; drill into the section-level command (`subscriptions renewals --within 7d`, `invoices audit`, `recommendations list --priority high`, `subscriptions list --status Trial`) when the user wants the full set.

`monthlyImpact` aggregates the urgent renewals + growth uplifts (the two impact-bearing categories that don't double-count). `dollarsOnTable` sums |dollarImpact| across audit items — over- and undercharges both count as money the partner should be moving.

**stdout/stderr contract.** The JSON envelope is the only thing on stdout. stderr may carry per-feed warnings on partial fetch failures (e.g. `⚠ Could not load invoices — audit findings suppressed`); the JSON on stdout stays well-formed even when one feed degrades. Discard stderr with `2>/dev/null` when piping. If you need to surface degraded-feed state to the user, capture stderr separately — `summary.totalItems` will be smaller than usual but the envelope shape is unchanged.

### Renewal triage
```
pax8 subscriptions renewals --json --within 30d
```
Returns `{ renewals, page }`. Sort `renewals` by `daysUntilRenewal` ascending; sum `mrrRenewing` across the rows yourself for the headline number — the CLI envelope carries no aggregate field. (The `@pax8/core` `RenewalReport` type does expose `totalMrrRenewing` / `totalArrRenewing`, but that's the library surface, not the CLI's.)

Lead with count + total Pax8 monthly cost renewing in the window. Show top 5 (company, product, days, Pax8 monthly cost). Offer to drill into any one with `pax8 subscriptions show <id> --json`.

For a longer horizon ranked by cost exposure, use `pax8 report renewals --within 180 --sort by-cost --json`. It returns a **flat, ungrouped** list of subscription rows — if the user wants per-customer or per-vendor rollups, that's `pax8 report concentration --by client|vendor`, not this command.

**`report renewals` uses different field names from `subscriptions renewals`.** Its envelope is `{ windowDays, renewals[], totalCount, totalMonthlyCostExposure: {amount,currency} }`, and rows are keyed `monthlyCost` / `commitmentTermEndDate` / `daysUntilEnd` / `vendorName` — not `mrrRenewing` / `renewalDate` / `daysUntilRenewal`. Note it *does* carry the aggregate (`totalMonthlyCostExposure`) that `subscriptions renewals` lacks.

### Invoice audit → action
```
pax8 invoices audit --json
```
Envelope: `{ discrepancies[], totalOvercharge, totalUndercharge, netImpact, itemsAudited, nextActions[] }`. Rows carry `discrepancyId` (**this is the `--discrepancy` argument** — there is no `id` field), `type`, `companyId`, `companyName`, `productName`, `invoicedQuantity`, `activeQuantity`, `delta`, and `dollarImpact`.

**Sign conventions — get these backwards and you send a partner to claim money that doesn't exist:**

| Field | Sign | Means |
|---|---|---|
| `dollarImpact` | positive | overcharge — Pax8 billed more than the subs justify |
| `dollarImpact` | negative | undercharge — Pax8 billed less; the partner is under-billed |
| `totalOvercharge` | positive sum | total billed in excess |
| `totalUndercharge` | positive sum of negative rows | total under-billed |
| `netImpact` | negative | net **under**-billed overall — nothing is owed back |
| `netImpact` | positive | net over-billed — there is money to reclaim |

**Check `itemsAudited` before reporting a clean bill of health.** `itemsAudited: 0` with zero discrepancies means *nothing was examined*, not *everything is fine* — the two are currently indistinguishable in the output (#709). Say "no invoices were in scope" rather than "no discrepancies found."

**Lead with the net, then the rows.** The instinct is to open with the biggest single discrepancy, but the portfolio position usually governs the advice. An account whose worst overcharge is $220 but which is net $5,911 *under*-billed is one where filing that dispute invites a reconciliation surfacing $6,296 of unbilled seats. Give the net first, then the worst row, then the recommendation — which may well be "don't file."

Group the rows by category, name the company/product and delta for each top finding, and suggest `pax8 invoices audit --company "<name>" --json` to drill in.

**Building a defensible dispute.** `AuditDiscrepancy` carries no `invoiceId` or `lineItemId`, so the join back to the invoice is by product-name match and takes three more calls: `invoices list --company <name>` (invoice id, dates, status) → `invoices items --invoice-id <id>` (line-item id, price, billing period) → `subscriptions list --company <name>` (active quantity). Do all three before drafting anything.

The strongest evidence is usually **sibling lines on the same invoice**: if two products billed 85 seats and a third billed 95 for the same user population, the invoice contradicts itself, and that's more persuasive than any external calculation.

### Recommendation → order
Run in parallel:
```
pax8 recommendations list --json --priority high
pax8 clients list --json
```
The recommendations call returns `{ recommendations, totalAvailable }` — capped at 10 by default and sorted by `estimatedMrrUplift` DESC (priority breaks ties; nulls sort last). If `totalAvailable` exceeds `recommendations.length`, more opportunities exist behind the cap; re-run with `--top 50` or `--top 0` (unlimited) to widen. For each rec, show: company, missing product, additional Pax8 monthly cost if acted on (wire-side field name: `estimatedMrrUplift`). To execute, use the `orderArgs` field — an argv array whose first element is `"pax8"` — and pass `orderArgs.slice(1)` to the Bash tool. The sibling `orderCommand` field is the same content as a human-readable display string; it interpolates the raw partner-controlled `companyName` and is unsafe to hand to a shell (#462), so use it only for previewing what the action will do, never for execution. **Always show the user the order preview and wait for explicit approval before executing the write.**

If the user asks *why* a recommendation surfaced, the `reason` and `rationaleSnippet` fields are already on each row of the `list` output and answer it directly. (`pax8 recommendations why <n>` is meant to do this in more depth but currently throws a raw TypeError — #715.)

For an interactive batch flow, hand the human `pax8 recommendations act` (with `--company` / `--product` / `--priority` filters as needed) — it presents a multi-select picker and a single batch confirmation rather than a per-rec y/s/q walk. The agent should not pass `--yes` unless the user has approved the entire matching set.

### Portfolio Pax8 cost
```
pax8 dashboard --json
```
`dashboard --json` emits portfolio-wide `monthlyCost` / `annualCost` — each a `{ amount, currency }` object, so read `.amount` — plus a `topCustomers` array whose entries carry their own `monthlyCost.{amount,currency}`, `seats`, and `subscriptions` count. Other top-level keys worth knowing: `totalCompanies`, `companiesWithActiveSubs`, `activeSubscriptions`, `activeTrials`, `totalSeats`, `renewalsNext30Days`, `urgentRenewals`, `mrrRenewing`, `highPriorityRecs`, `potentialMonthlyUplift`, `recentOrders`.

**`dashboard.urgentRenewals` counts a 14-day window, not 7** — unlike `pax8 today`, where "urgent" means ≤7 days (#712). The two will disagree, and dashboard's own hint text pairs the 14-day count with the 30-day dollar total. If the user asks what's urgent, get the number from `subscriptions renewals --within 7d` rather than leading with this field.

**Sanity-check `potentialMonthlyUplift` against `monthlyCost`** before quoting it — see the cost-math section.

Lead with total Pax8 monthly cost and the top 5 from `topCustomers`. For a per-vendor or per-product breakdown, use `pax8 report subscriptions --by vendor --json` or `pax8 report concentration --by product --json` rather than grouping raw rows yourself. Per-client vendor rollups live in `pax8 clients more "<name>" --json` under `vendors[]`.

Note: these figures are partner-side COST paid to Pax8, not partner-side resale revenue.

### "Where is my spend concentrated?" / risk analysis
```
pax8 report concentration --by client --top 10 --json
```
`--by` is required. Use `--by client` for customer-concentration risk ("what happens if our biggest account leaves"), `--by vendor` for supplier exposure, `--by product` for SKU mix. `--threshold <pct>` is the alternative to `--top` when the user cares about "everyone above 5%" rather than a fixed count.

### "What if?" — cost simulation
```
pax8 cost sim --company "<name>" --product "<name>" --quantity <n> --json
```
Use for SKU swaps (`--from "<current sku>"`), quantity changes (omit `--from`; the CLI auto-detects the existing subscription), or add-new (no current subscription). Lead with the delta number — "+$N/mo" or "−$N/mo" — and mention the per-seat impact when seats are unchanged. Read-only; no order is placed.

### "Who's missing X?" (cross-sell)
```
pax8 recommendations list --json --product "<name>"
```
Filter by product (e.g. `"backup"`, `"AvePoint"`, `"Entra"`). Returns ranked customers with estimated uplift and ready-to-run order commands.

When the user frames it as a cohort ("everyone on Business Basic who doesn't have Premium"), `pax8 recommendations upsell --from-product "..." --to-product "..."` answers it directly. Add `--with-contacts` only if they want someone to email — it costs an extra API call per company.

## Falling back to raw data

The recipes above cover the questions the CLI is opinionated about. For novel questions (custom analytics, ad-hoc joins, "show me all subscriptions ending in Q3 grouped by vendor"), use the raw list commands and assemble the answer yourself with `jq` — remembering to unwrap the envelope first:

```
pax8 subscriptions list --json --size 1000 | jq '.subscriptions'
pax8 invoices list --json | jq '.invoices'
pax8 clients list --json | jq '.companies'
```

For a genuinely full portfolio sweep, `pax8 subscriptions export --format jsonl` streams every row without pagination.

Don't reimplement what's already a first-class command (renewals, audit, recommendations, Pax8 cost rollups via `dashboard` / `report`) — those exist precisely because they're hard to get right from the raw shape.

## Error and edge cases

- **Auth not configured** (`401`, "credentials missing", or empty token errors): tell the user to run `pax8 auth login` or set `PAX8_CLIENT_ID` / `PAX8_CLIENT_SECRET`. Don't retry blindly.
- **No data to explore?** Suggest `PAX8_DEMO=1 pax8 <command>` so they can try with sample data. `pax8 demo status` reports whether persistent demo mode is already on — worth checking before you tell a partner their portfolio is empty.
- **Empty results** (e.g. `renewals --within 7d` returns `{ "renewals": [] }`): say so explicitly ("no renewals in the next 7 days"). Don't fabricate rows. Offer to widen the window.
- **A `jq` path returning `null`.** Suspect the envelope before you conclude there's no data — `.[]` on a wrapped object, or `.items` where the key is the resource name, both yield `null` rather than an error. Re-check with `jq 'keys'`.
- **Read `message`, not just `code`.** The codes are the machine-readable contract, but they are not always right: a missing resource currently surfaces as `ERROR_NOT_AUTHORIZED` with a message reading `Quote not found: Q-1001` (#712). Matching on the code alone would send a correctly-authenticated partner to re-run `pax8 auth login` — itself a write. When code and message disagree, believe the message.
- **`recoverySteps` are advisory and can be wrong.** They are authored hints, not verified fixes. `orders create` on a product needing a commitment term suggests `--commitment-term Monthly`, which returns the identical error. Try a recovery step once; if it reproduces the same failure, stop and tell the user rather than cycling through the rest.
- **Flag values are redacted in errors.** Invalid input comes back as `unknown option '<REDACTED:ARG>'` rather than naming the flag, so the error text alone won't tell you what you got wrong. Re-check against this skill's flag tables or `--help`; don't retry variations blindly.
- **Rate limit** (429): pause, summarize what you got, and surface the limit to the user. Don't hammer.
- **Diagnostic before giving up.** If something feels off (stale cache, weird timeouts, auth issues), `pax8 doctor` is the one-shot health check. Don't run it preemptively.
- **Ambiguous company/product names.** When the user gives a partial name, pass it through — the CLI resolves fuzzy matches and errors clearly if it can't.
- **Cold API (~30s).** First call after idle can be slow. Don't time out; don't retry in parallel.
