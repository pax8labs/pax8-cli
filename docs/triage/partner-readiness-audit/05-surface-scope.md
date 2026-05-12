# 05 — Surface area and scope

## Methodology

Examined the full command surface of v0.1.0 via:
- **Command inventory:** `e2e/command-inventory.ts` (source of truth for every command + per-command e2e spec)
- **Command registration:** `packages/cli/src/index.ts` and per-group `commands/<group>/index.ts` files
- **Source code scan:** grep for hidden commands, TODOs, TODO/FIXME/XXX/HACK/deprecated markers, and orphaned files
- **Environment variables:** all `PAX8_*` env vars found in `packages/*/src/`, cross-checked against documented vars in `CLAUDE.md` and `docs/UX_GUIDE.md`
- **Configuration schema:** `packages/core/src/config/schema.ts` for all config file fields
- **@pax8/core exports:** `packages/core/src/index.ts` for public API surface
- **Demo mode:** `packages/core/src/mock/demo-data.ts` for demo fixtures; checked for schema alignment

## Summary

| Metric | Count | Notes |
|--------|-------|-------|
| **Total commands** | 68 | Read: 39, Write: 29 |
| **Hidden commands** | 3 | 1 deprecation alias (`status`), 2 easter eggs (`moo`, `coffee`) |
| **Command groups** | 16 | auth, companies, config, contacts, cost, invoices, orders, products, quotes, recommendations, report, root, subscriptions, telemetry, usage, webhooks |
| **Environment variables** | 24 | 6 documented for partners; 18 internal/test-only |
| **Configuration file fields** | 9 | All documented in schema |
| **@pax8/core exports** | 70+ | Intentional; all documented in `packages/core/README.md` |
| **Known broken in v0.1.0** | 1 | `usage list` — real API 404 (#199-adjacent); demo path thin |

## Findings

### fix-soon-after-launch — Environment variables — Undocumented internal env vars could confuse partners

**File:** `packages/cli/src/` (grep for `PAX8_`)

**Evidence:** 24 distinct `PAX8_*` env vars found in codebase:
- **Documented for partners** (6): `PAX8_CLIENT_ID`, `PAX8_CLIENT_SECRET`, `PAX8_API_BASE`, `PAX8_TIMEOUT_MS`, `PAX8_DEMO`, `PAX8_YES`, `PAX8_QUIET`, `PAX8_TELEMETRY_DISABLED` (in `CLAUDE.md` §Environment variables)
- **Test/internal only** (18): `PAX8_ALLOW_INSECURE_BASE`, `PAX8_ALLOW_NON_HOME_CONFIG`, `PAX8_CACHE_WARMING`, `PAX8_DEBUG`, `PAX8_DEBUG_RAW`, `PAX8_DEMO_FAIL_ORDERS_LIST_TIMEOUT`, `PAX8_DEMO_FAIL_QUOTE_LINE_ITEM_ADD`, `PAX8_DISPUTES_DIR`, `PAX8_FAST_MOCK`, `PAX8_FORCE_TTY`, `PAX8_IDEMPOTENCY_DIR`, `PAX8_OUTPUT_FORMAT`, `PAX8_REPL`, `PAX8_TEST`, and others

The internal vars are scattered across test files and implementation details. Partners using environment variable scanning or automation may stumble on `PAX8_ALLOW_INSECURE_BASE` or `PAX8_OUTPUT_FORMAT` in error messages or debug output and be confused.

**Why it matters:**
- `PAX8_ALLOW_INSECURE_BASE` and `PAX8_ALLOW_NON_HOME_CONFIG` are security escape hatches that sound like intentional features.
- `PAX8_DEBUG` and `PAX8_DEBUG_RAW` may leak sensitive request bodies if partners enable them following support guidance.
- `PAX8_OUTPUT_FORMAT` sounds like a public flag but isn't exposed in any command's `--help`.

**Recommended fix:**
- Move internal env vars to a separate `PAX8_INTERNAL_*` namespace (e.g. `PAX8_INTERNAL_DEBUG`, `PAX8_INTERNAL_ALLOW_INSECURE_BASE`).
- Add a note in `docs/UX_GUIDE.md` or a new `ENVIRONMENT.md` listing *only* public env vars and explicitly marking the internal ones as undocumented.
- Update the `--help` output for global flags to mention where to find env var docs.

**Severity:** fix-soon-after-launch — Not a blocker but improves partner docs/UX before word spreads about the undocumented vars.

---

### accept — Deprecation alias — `status` command hidden but still functional

**File:** `packages/cli/src/index.ts:116`

**Evidence:**
```typescript
program.addCommand(statusCommand, { hidden: true });
```
Deprecation notice in `packages/cli/src/commands/dashboard.ts:553`:
```typescript
// Deprecated alias. Registered with `{ hidden: true }` in src/index.ts
```

The alias is tracked in the e2e matrix (`e2e/command-inventory.ts:855`) as `status` (deprecated) and emits a stderr deprecation message on every invocation.

**Why it matters:**
- Partners upgrading from pre-release versions still have scripts/aliases calling `pax8 status`.
- The command works end-to-end; the hiding is intentional.
- Deprecation is documented and flagged for v1.0 removal.

**Recommended fix:**
None before launch. Keep as-is until v1.0. This is the standard deprecation pattern.

---

### accept — Easter eggs — Two hidden commands (`moo`, `coffee`)

**File:** `packages/cli/src/index.ts:124-125`

**Evidence:**
```typescript
program.addCommand(mooCommand, { hidden: true });
program.addCommand(coffeeCommand, { hidden: true });
```
Commands at `packages/cli/src/commands/easter-eggs/moo.ts` and `coffee.ts`.

**Why it matters:**
- These are intentional easter eggs, not leftover debug code.
- They're hidden from `--help` and don't appear in the e2e matrix baseline.
- No risk to partners; they discover them by accident or by word of mouth.

**Recommended fix:**
None. Keep as-is.

---

### accept — Demo mode data — Fixtures cover all major entities; schema alignment sound

**File:** `packages/core/src/mock/demo-data.ts` (2105 lines) and `packages/core/src/mock/mock-client.ts` (944 lines)

**Evidence:**
- Demo data includes realistic but fictional companies, subscriptions, products, invoices, orders, contacts, quotes, webhooks, and usage.
- All entities have deterministic UUIDs and relative dates for reproducible testing.
- `MockPax8Client` passes the full e2e matrix under `PAX8_DEMO=1` (69+ assertions in `e2e/per-command.test.ts`).
- Schema alignment is implicit: command handlers call the same Zod validators on demo responses as on real API responses.

One known gap (tracked separately):
- `usage list` returns only 2 rows in demo fixtures; real API returned 404 on 2026-05-06. Issue: #199-adjacent.

**Why it matters:**
- Demo mode is the test posture, not an optional feature. New users run in demo mode first.
- If demo data mismatches API schema, the CLI silently breaks for real users after they get credentials.
- Current demo coverage is solid; gaps are marked in the inventory.

**Recommended fix:**
- Continue the #196 demo-data audit to widen invoice discrepancies and usage rows.
- No schema validation needed — the current implicit validation (parsing through real schemas) is sufficient.

---

### accept — @pax8/core public surface — Intentional, well-documented exports

**File:** `packages/core/src/index.ts` and `packages/core/README.md`

**Evidence:**
- 70+ exports covering clients, services, types, schemas, errors, auth, config, telemetry, and mock fixtures.
- Comments in `index.ts` explain the re-export philosophy: explicit (no `export *`) to prevent silent API growth.
- README markets the package as embeddable and documents the main services (renewals, invoice audit, recommendations, MRR, bulk executor).
- All types and services are used by the CLI and documented in the Anthropic skill.

The surface includes internal-helper symbols like `FileCache` and `resetTelemetry`, which are harmless and have legitimate external use cases (cache invalidation, test isolation).

**Why it matters:**
- External consumers (partners building on `@pax8/core`) see the same stable API as the bundled CLI.
- The explicit re-export philosophy ensures new internal APIs don't accidentally leak.

**Recommended fix:**
None. This is well-executed.

---

### accept — Configuration schema — All fields documented

**File:** `packages/core/src/config/schema.ts`

**Evidence:**
```typescript
export const ConfigSchema = z.object({
  version: z.literal("1.0"),
  demo: z.boolean().optional(),
  auth: z.object({ client_id: z.string().optional() }).optional(),
  defaults: z.object({
    output_format: z.enum(["table", "json", "csv"]).default("table"),
    page_size: z.number().min(1).max(100).default(50),
    confirm_destructive: z.boolean().default(true),
  }).default({}),
  cache: z.object({
    enabled: z.boolean().default(true),
    ttl_hours: z.number().default(24),
  }).default({}),
  telemetry: z.object({ enabled: z.boolean().default(false) }).default({}),
});
```

9 fields total:
- `version` — required
- `demo`, `auth.client_id` — optional
- `defaults.output_format`, `defaults.page_size`, `defaults.confirm_destructive` — optional with sensible defaults
- `cache.enabled`, `cache.ttl_hours` — optional with sensible defaults
- `telemetry.enabled` — optional, defaults to false (opt-in telemetry)

**Why it matters:**
- Config is user-facing; schema defines the contract.
- All fields are Zod-validated; typos in user config are caught.

**Recommended fix:**
None. This is clean and intentional.

---

### accept — Command completeness — No half-built or unfinished commands found

**File:** Full codebase scan with grep for `TODO.*critical`, `throw new Error.*not implemented`, `unfinished`, etc.

**Evidence:**
- No commands throw "not implemented" or similar blocking errors.
- One TODO in `packages/cli/src/commands/orders/create.ts:645` regarding Idempotency-Key request header support on the Pax8 API side — not a CLI issue.
- Deprecated methods in `@pax8/core` (renewal-tracker.ts) are marked `@deprecated` with retention notes and new names provided.
- All 68 commands in the inventory have complete demo paths and pass the e2e matrix (with one known gap: `usage list` 404).

**Why it matters:**
- Commands must be launch-ready or explicitly marked as experimental.
- The codebase is clean — no lurking half-baked features.

**Recommended fix:**
None. The only TODO is external (API feature request).

---

## Appendix: Full command tree

```
auth
  login
  logout
  status

companies
  create
  list
  more (detailed view)
  show
  update

config
  init
  path
  set
  show

contacts
  create
  delete
  list (per-company)
  show
  update

cost
  sim (cost simulation / "what if")

dashboard (root command)

doctor (root command)

init (root command)

invoices
  audit
  dispute
  items
  list
  show

orders
  create
  list
  show

products
  list
  search
  show

quotes
  create
  delete
  line-items add
  line-items list
  line-items remove
  list
  send
  show
  update

recommendations
  act (interactive workflow)
  list

report
  growth (growth analytics)
  mrr (MRR report)

report-bug (root command)

status (root command, deprecated alias for dashboard — hidden from --help)

subscriptions
  cancel
  list
  renewals (upcoming within N days)
  show
  update

telemetry
  disable
  enable
  status

usage
  list (known broken on real API — #199-adjacent)
  show

version (root command)

webhooks
  create
  delete
  disable
  enable
  list
  logs
  show
  test
  topics list
  update
```

**Notes:**
- 68 total commands: 39 reads (safe), 29 writes (need confirmation).
- All commands are in scope for v0.1.0. No experimental flags or alpha gates.
- Easter eggs (`moo`, `coffee`) hidden from `--help`.

