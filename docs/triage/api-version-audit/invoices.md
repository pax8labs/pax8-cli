# Invoices write API audit

**TL;DR:** `pax8 invoices dispute` **does not make any HTTP write call**. It is a deliberately local, draft-only command: it runs the read-only `auditInvoices` pipeline (which itself only issues GET requests to `/invoices`, `/invoices/{id}/items`, and `/subscriptions`) to locate a discrepancy, then writes a JSON dispute draft to `~/.pax8/disputes/<id>.json` (or `$PAX8_DISPUTES_DIR`) and prints a markdown support-ticket template. The CLI's own source explicitly documents the rationale (`packages/cli/src/commands/invoices/dispute.ts:21-32`): the Pax8 v1 API does not expose a public dispute / write-off / credit endpoint, so Pax8 billing disputes are handled out-of-band via the partner portal and support, and this command "closes the loop locally." The public OpenAPI spec (`/tmp/partner-endpoints.json`) confirms the absence — there is no `/invoices/{id}/dispute`, `/disputes`, `/credits`, `/adjustments`, or any non-GET verb on any `/invoices*` path. The command is honest about this in `--help` output and in the inline note at `dispute.ts:252-254`. **No API contract exists to verify.**

## Operations audited

| Command | Source file:lines | HTTP write call? | What it writes |
|---|---|---|---|
| `pax8 invoices dispute` | `packages/cli/src/commands/invoices/dispute.ts:226-449` | **No** | `~/.pax8/disputes/<draft-id>.json` (local file, mode `0o600`) |

---

## Operation: invoices dispute

### Does it make a wire call?

**No.** There is no `client.post/put/patch/delete` anywhere in `dispute.ts`. The only `ctx.api.*` calls in the command are reads, all inside the `findDiscrepancy()` helper, used to *locate* the discrepancy the user wants to dispute:

- `ctx.api.invoices.list({ month, companyId, size: 200 })` — `dispute.ts:137`
- `ctx.api.subscriptions.list({ companyId, size: ALL_SUBS_PAGE_SIZE })` — `dispute.ts:138`
- `ctx.api.invoices.listItems(inv.id, { size: 500 })` — `dispute.ts:143`

All three of those route through `Pax8Client.get` (`packages/core/src/api/invoices.ts:34, 63-66, 89-92`) and hit GET-only documented endpoints.

The `InvoicesApi` class in `packages/core/src/api/invoices.ts:17-120` exposes exactly four methods — `list`, `get`, `listItems`, `listDraftItems` — and every one of them is `client.get(...)`. **There is no `dispute()`, `post()`, or any other write-capable method on `InvoicesApi`.** The CLI's inline note at `dispute.ts:31-32` calls this out: "If/when Pax8 ships a real endpoint, the local-storage path can be replaced with `ctx.api.invoices.dispute(...)` without changing the CLI surface."

The dispute.test.ts test file corroborates that no API write happens:

- The happy-path test (`dispute.test.ts:24-52`) overrides `PAX8_DISPUTES_DIR` to a `mkdtemp`'d directory and asserts the draft lands on disk (`dispute.test.ts:50-51`). The recorded artifact is a local file, not an API response.
- The idempotency-replay test (`dispute.test.ts:71-104`) asserts that a second invocation with the same `--idempotency-key` produces a byte-for-byte identical `stdout` *and* does **not** create a second file on disk (`dispute.test.ts:101-103`) — i.e. the entire "write" is a file write, and replay is enforced purely by the local idempotency cache (`PAX8_IDEMPOTENCY_DIR`), with no network round-trip.
- All tests run in `PAX8_DEMO=1` mode (the default for the subprocess test harness). No `nock`/`msw` server is started for `dispute` — unlike the subscription write tests — because there is no HTTP traffic to intercept.

### What does it do instead?

Both a file write **and** stdout/stderr output. Specifically:

1. **Locates the discrepancy** via a read-only audit pass (`findDiscrepancy`, `dispute.ts:130-224`). The discrepancy ID is a SHA-1 hash of `companyId|productName|type|month`, truncated to 12 hex chars and prefixed `disc-` (`dispute.ts:45-53`). This is the same hash function `invoices audit` uses to stamp its output — see "Cross-reference" below.
2. **Prompts for confirmation** (`dispute.ts:363-369`), respecting `--yes` / `PAX8_YES=1` per the project's read-vs-write contract.
3. **Writes a draft file** atomically via `writeDraft()` (`dispute.ts:109-117`): `fs.writeFile(tmp, ..., { mode: 0o600 })` then `fs.rename(tmp, fp)`. Path = `${PAX8_DISPUTES_DIR ?? ~/.pax8/disputes}/disp-<8 hex>.json` (`dispute.ts:37-39, 372, 385`). The file contains the full `DisputeDraft` record (`dispute.ts:55-71`) including a pre-rendered `portalTemplate` — a markdown-ish support-ticket body produced by `buildPortalTemplate()` (`dispute.ts:73-107`).
4. **Prints output**: in `--json` mode the draft plus `filePath` and `nextActions` go to stdout (`dispute.ts:392-409`); in human mode the draft ID, save path, and the portal-ready template go to stdout, and the "next steps" hint goes to stderr (`dispute.ts:415-426`).
5. **Honors idempotency**: the whole operation is wrapped in `withIdempotency` (`dispute.ts:290-430`) keyed by `--idempotency-key` + `hashArgs({discrepancy, company, product, month, reason})`. `markWriteInFlight("invoices", undefined, idempotencyKey)` (`dispute.ts:382`) registers the SIGINT cleanup — the same convention real wire-write commands use, even though here the only thing in flight is an `fs.rename`.

Where does the `--discrepancy` ID come from? From a previous `pax8 invoices audit --json` run (the audit command's `nextActions[].command` field hands the partner the exact `pax8 invoices dispute --discrepancy disc-<id>` invocation). See "Cross-reference" below.

### Wire path (if applicable)

N/A — there is no wire write.

For completeness, the reads issued during `findDiscrepancy` resolve to:

- `GET https://api.pax8.com/v1/invoices?...`
- `GET https://api.pax8.com/v1/invoices/{id}/items?...`
- `GET https://api.pax8.com/v1/subscriptions?...`

(via `Pax8Client.baseUrl` defaulting to `FALLBACK_BASE_URL = "https://api.pax8.com/v1"` at `packages/core/src/api/client.ts:20, 37-41, 267-278`). Those reads are out of scope for this audit.

### Public spec location

**Absent by design.** `jq '.paths | keys' /tmp/partner-endpoints.json | grep -i invoice` returns exactly four endpoints:

```
"/invoices",
"/invoices/draftItems",
"/invoices/{invoiceId}",
"/invoices/{invoiceId}/items",
```

Every one of them exposes **only `get`** (verified individually via `jq '.paths."<path>" | keys'` — all four return `["get"]`). `jq '.paths | keys[]' /tmp/partner-endpoints.json | grep -iE "dispute|credit|adjustment|writeoff|write-off"` returns no matches. There is no documented public endpoint for filing a billing dispute, requesting a credit memo, or otherwise writing back to an invoice.

The CLI's behavior is consistent with that absence: rather than POST to a speculative or undocumented internal endpoint, it writes locally and renders a portal template the user can paste into the partner portal. This is the right choice given the spec.

### Request body shape (if applicable)

N/A — no body sent over the wire. For reference, the locally-written `DisputeDraft` JSON shape is defined at `dispute.ts:55-71`:

```
{
  id: "disp-<8 hex>",
  discrepancyId: "disc-<12 hex>",
  status: "draft",
  createdAt: ISO-8601,
  month?: "YYYY-MM",
  companyId, companyName, productName,
  type: "overcharge" | "undercharge" | "missing" | "unexpected",
  invoicedQuantity, activeQuantity, delta, dollarImpact,
  reason?,
  portalTemplate: <multi-line string>,
}
```

This shape is internal to the CLI; there is no Zod input schema in `packages/core/src/api/types.ts` for a dispute payload (and there shouldn't be — no API consumes it).

### Reconciliation case

**Unique case: F — draft-only by design, no API surface exists.** This doesn't fit the A–E cases used for subscriptions (those all assume *some* wire call). The CLI is transparent about it: the file-header comment (`dispute.ts:20-33`), the `--help` epilog (`dispute.ts:252-254`), and the absence of any `InvoicesApi.dispute(...)` method all converge on the same story. The closest analog is "deliberate divergence with explicit user-facing disclosure" — the command performs a `write` from the partner's perspective (it materializes durable state, prompts, takes an idempotency key, marks a write-in-flight, exits 130 on SIGINT) but the durable state is local-only.

**Is the UX misleading?** Mostly no:

- The `--help` text at `dispute.ts:252-254` says, verbatim, "The Pax8 v1 API does not expose a public dispute endpoint, so this command files a local draft and produces a support ticket template you can paste into the Pax8 portal."
- Human-mode output explicitly prints "Saved to: `<filePath>`" (`dispute.ts:417`), shows the portal template, and tells the user to paste it into the portal (`dispute.ts:425`).
- The draft's `status: "draft"` field and the spinner text "Filing dispute..." (`dispute.ts:381`) could read as "filing with Pax8" to a skim-reader, but the surrounding output (file path, portal template, "paste into Pax8 portal" hint) corrects that impression in the same render.

One small UX risk: the `nextActions[0]` in `--json` output (`dispute.ts:396-400`) suggests `cat "<filePath>"` — a hint that the artifact is local — but doesn't include an action like `open https://app.pax8.com/...` that walks the user to the portal. Not a wire issue, just a closed-loop suggestion.

### Recommendation

**No code change needed; flag as deliberate divergence (case F).** The command honestly presents itself as a draft generator, the public spec confirms no dispute endpoint exists, and the seam (`ctx.api.invoices.dispute(...)`) is pre-cut for the day Pax8 ships one. Optional documentation polish: surface this in the audit-suite TL;DR so consumers of the audit pack don't have to re-derive that "invoices write" means "local file write."

---

## Cross-reference: where does the discrepancy data come from?

The closed loop between `invoices audit` and `invoices dispute` is fully in-process — no API state is involved on either side. Specifically:

- `dispute.ts:45-53` defines and exports `discrepancyId({companyId, productName, type, month})` as `"disc-" + sha1(companyId|productName|type|month).slice(0,12)`.
- `audit.ts:13` imports that **same function** from `./dispute.js` and uses it at `audit.ts:97-105` to stamp every discrepancy in its output with a `discrepancyId` field.
- `audit.ts:109-114` emits `nextActions[].command` strings of the form `pax8 invoices dispute --discrepancy <id> [--month YYYY-MM]`, handing the partner (or an agent) the exact replay invocation.
- When `dispute` runs with `--discrepancy <id>`, it re-executes `auditInvoices` over the same reads and uses the same `discrepancyId(...)` hash to match (`dispute.ts:165-182`). Same inputs → same hash → match.

This means the end-to-end "expected path" is:

1. `pax8 invoices audit --json` → reads `/invoices`, `/invoices/{id}/items`, `/subscriptions` (GET-only), computes discrepancies, stamps IDs.
2. Partner/agent picks an ID from `nextActions`.
3. `pax8 invoices dispute --discrepancy <id>` → re-runs the same reads (no caching across commands), re-derives the same ID, locates the matching discrepancy, writes a draft to disk, prints the portal template.
4. Partner pastes the template into the Pax8 portal billing-support flow (out-of-band; not automated by the CLI).
5. Optionally `pax8 invoices audit --month <m>` again later to confirm resolution — this is suggested in `nextActions[1]` at `dispute.ts:401-404`.

The IDs are not stored on any Pax8 server. They are a content hash of the discrepancy's identity columns, and they round-trip between the two commands purely because both commands compute the same hash from the same inputs. If the underlying invoice/subscription data changes between the audit run and the dispute run, the hash will still match (assuming `companyId|productName|type|month` is unchanged), but the discrepancy itself may have resolved — at which point `dispute` would throw `ERROR_INVALID_INPUT` with "No discrepancy matches ID …" (`dispute.ts:170-180`).

## Constraints honored

- **READ-ONLY** — no source files were modified. Only `docs/triage/api-version-audit/invoices.md` was created.
- **File-and-line citations** — every CLI claim is anchored to `dispute.ts`, `dispute.test.ts`, `audit.ts`, or `invoices.ts` with explicit line numbers.
- **Spec citations** — the absence of a dispute endpoint is documented via the four `jq '.paths | keys'` results on `/tmp/partner-endpoints.json` and the per-path `keys` verification showing each invoice endpoint is `get`-only.
- **No speculation** — the audit does not claim Pax8 "probably has" a dispute endpoint elsewhere; it cites the public spec's `paths | keys` output and stops there.
- **No live API calls** — no `pax8 …` commands were executed during this audit; all evidence is from static source reads and `jq` queries against the local OpenAPI file.
- **Worktree-relative paths** — all CLI/spec citations use paths rooted at `/tmp/pax8-cli-api-audit/...` or the spec file `/tmp/partner-endpoints.json`.
