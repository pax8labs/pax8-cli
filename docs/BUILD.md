# Autonomous Build Prompt — pax8-cli MVP

You are building `pax8-cli`, an open-source CLI for MSPs to manage Pax8 cloud marketplace operations. This document contains everything you need to build the MVP autonomously without human input.

Read `docs/PRD.md` first for full context. This document is your execution plan.

---

## Ground Rules

1. **Do not ask questions.** Make reasonable decisions and document them in commit messages. If a decision is genuinely ambiguous, pick the simpler option.
2. **Test everything.** Every module gets unit tests. Every command gets subprocess integration tests. Target 80%+ coverage.
3. **Commit frequently.** Small, focused commits after each logical unit of work. Never commit broken code — run tests before every commit.
4. **Match the PRD UX exactly.** The command names, flag names, output formats, and error messages in the PRD are the spec. Follow them precisely.
5. **Follow existing patterns.** Once you establish a pattern (e.g., how a command file is structured), replicate it consistently across all commands.
6. **No placeholders.** Every feature you build should be complete and functional. If something depends on a real Pax8 API key, it should work with one and fail gracefully without one.
7. **Demo mode from day one.** All commands must work in demo mode with realistic mock data so the CLI can be tested and demonstrated without API credentials.

---

## Phase 1: Project Scaffolding

### 1.1 Monorepo Setup

```
pax8-cli/
├── package.json              # Root workspace config
├── pnpm-workspace.yaml
├── tsconfig.json             # Base TypeScript config (strict mode)
├── tsconfig.build.json       # Build config (excludes tests)
├── vitest.config.ts          # Shared test config
├── .gitignore
├── .eslintrc.cjs
├── .prettierrc
├── docs/
│   ├── PRD.md
│   └── BUILD.md
├── packages/
│   ├── cli/
│   │   ├── package.json      # @pax8/cli — bin: { pax8: ./dist/index.js }
│   │   ├── tsconfig.json
│   │   └── src/
│   ├── core/
│   │   ├── package.json      # @pax8/core
│   │   ├── tsconfig.json
│   │   └── src/
│   └── claude-skill/
│       ├── package.json      # @pax8/claude-skill
│       └── skill.md
```

**Dependencies:**
- Root: `pnpm`, `typescript`, `vitest`, `eslint`, `prettier`, `tsup`, `@vitest/coverage-v8`
- `@pax8/core`: `zod`, `undici` (or built-in fetch for Node 20+), no chalk/ora (headless)
- `@pax8/cli`: `commander`, `chalk`, `cli-table3`, `ora`, `yaml`, `@pax8/core`

**TypeScript config:**
- Strict mode, ES2022 target, NodeNext module resolution
- Path aliases: `@pax8/core` resolves to `../core/src`

**Scripts:**
```json
{
  "build": "pnpm -r build",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "lint": "eslint packages/*/src/**/*.ts",
  "format": "prettier --write .",
  "dev": "pnpm --filter @pax8/cli dev"
}
```

### 1.2 Initial Commit Checklist
- [ ] All config files created and working
- [ ] `pnpm install` succeeds
- [ ] `pnpm build` succeeds (empty packages compile)
- [ ] `pnpm test` succeeds (no tests yet, exits clean)
- [ ] `.gitignore` covers `node_modules`, `dist`, `.pax8`, `.env`, `*.tgz`

---

## Phase 2: Core Package (`@pax8/core`)

Build the core package first. It has zero CLI dependencies — pure business logic and API client.

### 2.1 Auth Module (`core/src/auth/`)

**`token-manager.ts`**
- OAuth 2.0 client credentials flow against `POST https://api.pax8.com/v1/token`
- Request body: `{ client_id, client_secret, grant_type: "client_credentials", audience: "https://api.pax8.com" }`
- Cache token in memory with TTL tracking (tokens last 24h, refresh at 23h)
- Methods: `getToken(): Promise<string>`, `isAuthenticated(): boolean`, `clearToken(): void`
- Throw typed `AuthError` on failure with parsed error message

**`credential-store.ts`**
- Priority chain: keytar (OS keychain) → `PAX8_CLIENT_ID`/`PAX8_CLIENT_SECRET` env vars → `~/.pax8/credentials.json`
- Methods: `getCredentials(): Promise<{clientId, clientSecret}>`, `saveCredentials(...)`, `clearCredentials()`
- Graceful degradation: if keytar fails (no native module), fall back to env/file with a warning
- Never log or return the client_secret in any output

**Tests:**
- Token manager: mock HTTP responses (success, 401, network error, token refresh)
- Credential store: test each fallback in the chain
- Test that expired tokens trigger refresh

### 2.2 API Client (`core/src/api/`)

**`client.ts` — Base HTTP Client**
- Constructor: `new Pax8Client({ tokenManager: TokenManager })`
- Methods: `get<T>(path, params?)`, `post<T>(path, body)`, `put<T>(path, body)`, `patch<T>(path, body)`, `delete(path)`
- Automatic `Authorization: Bearer <token>` header injection via token manager
- Base URL: `https://api.pax8.com/v1`
- Automatic pagination: `getPaginated<T>(path, params?)` returns async iterator that follows pages
- Rate limit handling: parse `429` responses, wait for reset, retry automatically (max 3 retries)
- Retry on 5xx with exponential backoff (1s, 2s, 4s)
- Request/response logging when `PAX8_DEBUG=1` (to stderr, never stdout)
- Zod validation on all response bodies — throw typed `ApiError` with status code, message, and request context
- Timeout: 30s default, configurable

**Response types** — define Zod schemas for every API entity:

```typescript
// core/src/api/types.ts
export const CompanySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.object({ ... }).optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  // ... all fields from Pax8 API
});
export type Company = z.infer<typeof CompanySchema>;

export const PaginatedResponseSchema = <T>(itemSchema: z.ZodType<T>) =>
  z.object({
    page: z.object({
      size: z.number(),
      totalElements: z.number(),
      totalPages: z.number(),
      number: z.number(),
    }),
    content: z.array(itemSchema),
  });
```

**Resource modules** — one file per API resource, each exporting a class:

**`companies.ts`**
```typescript
export class CompaniesApi {
  constructor(private client: Pax8Client) {}
  list(params?: { page?: number; size?: number }): Promise<PaginatedResponse<Company>>
  get(id: string): Promise<Company>
  create(data: CreateCompanyInput): Promise<Company>
  update(id: string, data: UpdateCompanyInput): Promise<Company>
}
```

Implement the same pattern for:
- **`contacts.ts`** — list (by company), get, create, update, delete
- **`products.ts`** — list, get, getPricing, getProvisioningDetails, getDependencies
- **`orders.ts`** — list, get, create
- **`subscriptions.ts`** — list, get, getHistory, update, delete (cancel)
- **`invoices.ts`** — list, get, listItems, listDraftItems
- **`usage.ts`** — listSummaries, getSummary, listLines
- **`quotes.ts`** — list, get, create, update, delete (plus sub-resources)
- **`webhooks.ts`** — list topics, create, update config, update status, add/replace/remove topics, delete, test, logs, retry

**Tests for each resource module:**
- Mock HTTP responses with realistic Pax8 API payloads
- Test pagination (multiple pages)
- Test error responses (404, 400, 429, 500)
- Test Zod validation catches malformed responses

### 2.3 Services (`core/src/services/`)

**`renewal-tracker.ts`**
- `getUpcomingRenewals(subscriptions: Subscription[], withinDays: number): RenewalReport`
- Parses `commitmentTermEndDate` from subscription data
- Sorts by urgency (soonest first)
- Flags annual subscriptions (higher risk than monthly)
- Computes days remaining, MRR at risk
- Returns structured report with per-company breakdown

**`invoice-auditor.ts`**
- `auditInvoices(invoiceItems: InvoiceItem[], subscriptions: Subscription[]): AuditReport`
- Cross-references invoice line items with active subscription quantities
- Identifies: overcharges, undercharges, missing items, unexpected items
- Computes dollar impact per discrepancy
- Returns structured report

**`analytics.ts`**
- `computeMrr(subscriptions: Subscription[]): MrrReport` — aggregate by company, product, vendor
- `computeGrowth(invoices: Invoice[], months: number): GrowthReport` — MRR trend over time
- Pure functions, no API calls — operate on pre-fetched data

**`cache.ts`**
- File-based cache in `~/.pax8/cache/`
- Key-value with TTL (default 24h for product catalog, 1h for company list)
- Methods: `get<T>(key)`, `set<T>(key, value, ttlMs)`, `invalidate(key)`, `clear()`
- JSON serialization, atomic writes

**`bulk-executor.ts`**
- `executeBulk<T>(operations: BulkOp[], concurrency: number): Promise<BulkResult<T>>`
- Configurable concurrency (default 5, max 10)
- Rate-limit aware: pauses all workers on 429, resumes after reset
- Returns per-operation success/failure with errors
- Progress callback: `onProgress(completed: number, total: number, current: BulkOp)`

**Tests:**
- Renewal tracker: test with mix of annual/monthly, past/future renewals, edge cases (today, tomorrow)
- Invoice auditor: test overcharge, undercharge, missing, clean scenarios
- Analytics: test MRR aggregation by different dimensions
- Cache: test TTL expiry, invalidation, concurrent access
- Bulk executor: test concurrency limits, rate-limit pausing, partial failures

### 2.4 Config (`core/src/config/`)

**`schema.ts`**
```typescript
export const ConfigSchema = z.object({
  version: z.literal("1.0"),
  auth: z.object({
    client_id: z.string().optional(),
  }).optional(),
  defaults: z.object({
    output_format: z.enum(["table", "json", "csv"]).default("table"),
    page_size: z.number().min(1).max(100).default(50),
    confirm_destructive: z.boolean().default(true),
  }).default({}),
  cache: z.object({
    enabled: z.boolean().default(true),
    ttl_hours: z.number().default(24),
  }).default({}),
});
```

**`loader.ts`**
- Looks for config at `~/.pax8/config.yaml`, falls back to defaults
- Merges file config with env var overrides
- Validates with Zod, returns typed config
- `ensureConfigDir()` creates `~/.pax8/` if missing

### 2.5 Demo Data (`core/src/mock/`)

**`demo-data.ts`**
- Realistic mock data for all entity types
- 5 companies with varied profiles (small MSP client, enterprise, startup, etc.)
- 15-20 subscriptions across companies (mix of Microsoft 365, security tools, backup)
- Invoices for the last 3 months with realistic line items
- Products matching real Pax8 catalog entries (use real product names)
- Some subscriptions renewing within 7/14/30 days
- Some invoice discrepancies (for audit testing)
- Usage data for consumption-based products

**`mock-client.ts`**
- Implements same interface as `Pax8Client` but returns demo data
- Simulates pagination (returns page.totalPages, page.number correctly)
- Simulates realistic latency (50-200ms random delay)
- Supports filtering/search on mock data (e.g., company name filter actually filters)

---

## Phase 3: CLI Package (`@pax8/cli`)

### 3.1 Entry Point and Program Setup

**`cli/src/index.ts`**
- `#!/usr/bin/env node` shebang
- Create Commander program with `createProgram()` factory
- Register all commands
- Global options: `--json`, `--csv`, `--quiet`, `--verbose`, `--no-color`, `--config <path>`
- Version from package.json
- Error handling: catch unhandled errors, format with `handleCommandError()`
- Auto-detect demo mode: `PAX8_DEMO=1` env var or `pax8 config set demo true`

**Output format auto-detection:**
```typescript
function getOutputFormat(options: GlobalOptions): "table" | "json" | "csv" {
  if (options.json) return "json";
  if (options.csv) return "csv";
  if (!process.stdout.isTTY) return "json";  // Piped output defaults to JSON
  return config.defaults.output_format || "table";
}
```

### 3.2 Shared CLI Utilities (`cli/src/lib/`)

**`output.ts`** — Unified output handling
```typescript
export function output(data: any[], options: { format: string; columns?: Column[] }): void
// Table: uses cli-table3 with chalk colors
// JSON: JSON.stringify(data, null, 2)
// CSV: header row + data rows, properly escaped
// Quiet: no output (for scripts that only care about exit code)
```

**`spinner.ts`** — Spinner wrapper (same pattern as agentsync)
- Uses `ora` with stderr stream
- Methods: `createSpinner(text)` returns spinner with `.start()`, `.succeed()`, `.fail()`, `.warn()`
- Auto-disables in non-TTY, quiet mode, or JSON output mode

**`errors.ts`** — Error formatting
```typescript
export class CliError extends Error {
  constructor(
    message: string,
    public causes?: string[],
    public recoverySteps?: string[],
    public docsUrl?: string
  ) { super(message); }
}

export function handleCommandError(error: unknown, spinner?: Ora, context?: string): never {
  // Stop spinner if active
  // Format error with causes and recovery steps
  // Print to stderr
  // Exit with appropriate code (1 for runtime, 2 for usage)
}
```

**`formatters.ts`** — Display formatting helpers
- `formatTimeAgo(date)` → "5d ago", "2h ago", "just now"
- `formatCurrency(cents)` → "$1,234.56"
- `formatQuantity(n)` → "45 seats"
- `formatStatus(status)` → colored status with icon (✓ Active, ✗ Cancelled, ● Pending)
- `formatCompanyName(name, maxLen)` → truncated with ellipsis if needed
- `formatDate(iso)` → "Mar 25, 2026"
- `formatDaysUntil(date)` → "in 6 days", "in 2 months", "tomorrow", "today"

**`confirm.ts`** — Confirmation prompts
```typescript
export async function confirm(message: string, options?: { default?: boolean }): Promise<boolean>
export async function confirmDestructive(message: string, keyword: string): Promise<boolean>
// confirmDestructive requires typing a specific word (e.g., "cancel") to proceed
```

**`context.ts`** — Command context builder
```typescript
export async function buildContext(options: GlobalOptions): Promise<CommandContext> {
  // Load config
  // Initialize credential store
  // Initialize token manager (or mock for demo mode)
  // Initialize API client (or mock for demo mode)
  // Return typed context with all dependencies ready
}
// Every command calls this first. It handles demo mode transparently.
```

**Tests for each utility:**
- Output: test all 4 formats with sample data
- Spinner: test TTY vs non-TTY behavior
- Errors: test formatting with causes, recovery steps, and without
- Formatters: test edge cases (0, negative, null, very large numbers)
- Context: test demo mode vs real mode initialization

### 3.3 Command Implementation

Implement each command following this exact pattern:

```typescript
// cli/src/commands/companies/list.ts
import { Command } from "commander";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";

export const companiesListCommand = new Command("list")
  .description("List all companies")
  .option("--page <number>", "Page number", parseInt)
  .option("--size <number>", "Page size", parseInt)
  .addHelpText("after", `
Examples:
  pax8 companies list
  pax8 companies list --json
  pax8 companies list --csv > companies.csv`)
  .action(async (options) => {
    const spinner = createSpinner("Fetching companies...").start();
    try {
      const ctx = await buildContext(options);
      const companies = await ctx.api.companies.list({
        page: options.page,
        size: options.size,
      });
      spinner.stop();

      output(companies.content, {
        format: ctx.outputFormat,
        columns: [
          { key: "name", header: "Name" },
          { key: "id", header: "ID" },
          // ...
        ],
      });

      if (ctx.outputFormat === "table") {
        console.log(`\n  ${companies.page.totalElements} companies`);
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to list companies");
    }
  });
```

**Command implementation order** (build in this exact sequence, commit after each):

1. **`auth login`** — credential prompt/flags → store → test token → success message
2. **`auth status`** — show stored credentials (masked), token state, expiry
3. **`auth logout`** — clear credentials from all stores
4. **`config init`** — create `~/.pax8/config.yaml` with defaults
5. **`config show`** — display current config
6. **`config set`** — update a config value
7. **`config path`** — print config directory path
8. **`doctor`** — check auth, connectivity, config validity, Node version, disk space for cache
9. **`version`** — print version from package.json
10. **`completions`** — generate shell completions (bash, zsh, fish)
11. **`companies list`** — paginated company listing
12. **`companies show`** — single company detail, with `--subscriptions` flag
13. **`companies create`** — create company with validation
14. **`companies update`** — update company fields
15. **`subscriptions list`** — paginated, with `--company` filter
16. **`subscriptions show`** — single subscription detail, with `--history` flag
17. **`subscriptions update`** — update quantity/billing term with confirmation for reductions
18. **`subscriptions cancel`** — cancel with destructive confirmation (type "cancel")
19. **`subscriptions renewals`** — renewal tracking report (uses `renewal-tracker` service)
20. **`products list`** — paginated product listing
21. **`products show`** — single product with `--pricing`, `--provisioning`, `--dependencies` flags
22. **`products search`** — text search across products (uses cache for speed)
23. **`invoices list`** — paginated, with `--month` and `--company` filters
24. **`invoices show`** — single invoice detail
25. **`invoices items`** — invoice line items with filters
26. **`invoices audit`** — billing reconciliation report (uses `invoice-auditor` service)

### 3.4 Subprocess Integration Tests

Every command gets a subprocess integration test:

```typescript
// cli/src/__tests__/companies-list.test.ts
import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

describe("pax8 companies list", () => {
  it("lists companies in table format", async () => {
    const { stdout, exitCode } = await runCliExpectSuccess(["companies", "list"]);
    expect(stdout).toContain("Name");
    expect(stdout).toContain("companies");
  });

  it("outputs JSON when --json flag is set", async () => {
    const { stdout } = await runCliExpectSuccess(["companies", "list", "--json"]);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("name");
  });

  it("outputs CSV when --csv flag is set", async () => {
    const { stdout } = await runCliExpectSuccess(["companies", "list", "--csv"]);
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toContain("name");  // header row
    expect(lines.length).toBeGreaterThan(1);
  });

  it("shows help text with examples", async () => {
    const { stdout } = await runCliExpectSuccess(["companies", "list", "--help"]);
    expect(stdout).toContain("Examples:");
    expect(stdout).toContain("pax8 companies list");
  });
});
```

**Test utilities (`cli/src/__tests__/test-utils.ts`):**
```typescript
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);
const CLI_PATH = resolve(__dirname, "../../dist/index.js");

export async function runCli(args: string[], env?: Record<string, string>) {
  const result = await exec("node", [CLI_PATH, ...args], {
    env: { ...process.env, PAX8_DEMO: "1", NO_COLOR: "1", ...env },
    timeout: 15000,
  });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
}

export async function runCliExpectSuccess(args: string[]) {
  const result = await runCli(args);
  expect(result.exitCode).toBe(0);
  return result;
}

export async function runCliExpectFailure(args: string[]) {
  try {
    await runCli(args);
    throw new Error("Expected CLI to fail");
  } catch (error: any) {
    return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code };
  }
}
```

All integration tests run in demo mode (`PAX8_DEMO=1`) so they need no real API credentials.

---

## Phase 4: Instrumentation & Telemetry

### 4.1 Telemetry Module (`core/src/telemetry/`)

**`telemetry.ts`**
- Opt-in only, disabled by default
- Respects `PAX8_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK` env vars
- Check `~/.pax8/config.yaml` for `telemetry.enabled` setting
- First-run notice: print once (track in `~/.pax8/.telemetry-notice-shown`)

**What to collect:**
```typescript
interface TelemetryEvent {
  event: "command_executed";
  command: string;          // e.g., "subscriptions.list"
  flags: string[];          // Flag names only, never values: ["--company", "--json"]
  duration_ms: number;
  success: boolean;
  error_code?: string;      // e.g., "AUTH_FAILED", "RATE_LIMITED" — never error messages
  cli_version: string;
  node_version: string;
  os: string;               // "darwin", "linux", "win32"
  demo_mode: boolean;
}
```

**What to NEVER collect:**
- Company IDs, names, or any customer data
- Subscription, invoice, or product data
- API credentials or tokens
- File paths
- Error messages (only error codes)
- Flag values (only flag names)
- Environment URLs

**Implementation:**
- Buffer events in memory, flush on process exit
- Store locally in `~/.pax8/telemetry/` as JSONL files
- No remote endpoint in MVP — just local collection for analysis
- Add `pax8 telemetry status`, `pax8 telemetry enable`, `pax8 telemetry disable` commands

### 4.2 Command Instrumentation

Wrap every command action with telemetry:

```typescript
// cli/src/lib/instrumented-action.ts
export function instrumentedAction(
  commandName: string,
  action: (options: any) => Promise<void>
) {
  return async (options: any) => {
    const start = performance.now();
    const flags = extractFlagNames(options);
    try {
      await action(options);
      telemetry.track({ command: commandName, flags, duration_ms: performance.now() - start, success: true });
    } catch (error) {
      telemetry.track({ command: commandName, flags, duration_ms: performance.now() - start, success: false, error_code: classifyError(error) });
      throw error;
    }
  };
}
```

### 4.3 Performance Metrics

Track and expose in `--verbose` mode:
- API call count per command
- Total API time vs. processing time
- Cache hit/miss ratio
- Rate limit encounters

---

## Phase 5: End-to-End Test Suite

### 5.1 User Flow Tests

These test complete user workflows as subprocess integration tests, verifying the CLI works end-to-end in demo mode.

**`e2e/onboarding.test.ts`** — First-time user experience
```
1. pax8 doctor → reports no auth configured
2. pax8 auth login --client-id demo --client-secret demo → succeeds (demo mode)
3. pax8 auth status → shows authenticated
4. pax8 companies list → shows demo companies
5. pax8 companies show "Acme Corp" --subscriptions → shows company with subscriptions
```

**`e2e/subscription-management.test.ts`** — Daily subscription workflows
```
1. pax8 subscriptions list → shows all subscriptions
2. pax8 subscriptions list --company "Acme Corp" → filtered list
3. pax8 subscriptions show <id> → subscription detail
4. pax8 subscriptions show <id> --history → includes history
5. pax8 subscriptions renewals --within 30d → renewal report
6. pax8 subscriptions renewals --within 7d → urgent renewals only
```

**`e2e/billing-workflow.test.ts`** — Invoice and audit workflows
```
1. pax8 invoices list → shows recent invoices
2. pax8 invoices list --month 2026-03 → filtered by month
3. pax8 invoices items --month 2026-03 --csv → CSV output
4. pax8 invoices audit → shows discrepancies with dollar amounts
```

**`e2e/product-discovery.test.ts`** — Product search and pricing
```
1. pax8 products search "Microsoft 365" → matching products
2. pax8 products show <id> --pricing → includes pricing tiers
3. pax8 products search "nonexistent" → helpful empty state message
```

**`e2e/output-formats.test.ts`** — Output format consistency
```
For each major list command:
1. Default (table) → has headers, aligned columns, summary footer
2. --json → valid JSON, array of objects with expected keys
3. --csv → valid CSV, header row matches JSON keys
4. --quiet → no output (exit code 0)
5. Piped (non-TTY) → defaults to JSON
```

**`e2e/error-handling.test.ts`** — Error scenarios
```
1. pax8 subscriptions show nonexistent-id → structured error with recovery steps
2. pax8 companies list (no auth) → auth error with setup instructions
3. pax8 subscriptions update <id> --quantity -1 → validation error
4. pax8 nonexistent-command → usage error with suggestions
```

### 5.2 Coverage Requirements

| Package | Unit Test Coverage | Integration Test Coverage |
|---------|-------------------|-------------------------|
| `@pax8/core` | 85%+ | N/A |
| `@pax8/cli` | 70%+ | Every command has at least 3 subprocess tests |
| E2E flows | N/A | 6 complete user workflows |

---

## Phase 6: Claude Skill

### 6.1 Skill Definition

**`claude-skill/skill.md`**
```markdown
---
name: pax8
description: Manage Pax8 cloud marketplace operations — query customers, subscriptions, invoices, renewals, and products
tools:
  - pax8_companies_list
  - pax8_companies_show
  - pax8_subscriptions_list
  - pax8_subscriptions_renewals
  - pax8_invoices_list
  - pax8_invoices_audit
  - pax8_products_search
  - pax8_report_mrr
---

You have access to Pax8 cloud marketplace data through the pax8 CLI. Use these tools to answer questions about MSP customers, subscriptions, billing, renewals, and products.

When answering questions:
- Always present data in a clear, summarized format — don't dump raw JSON
- Proactively highlight items that need attention (upcoming renewals, billing discrepancies)
- When showing financial data, include totals and context
- If a question requires data from multiple tools, call them in parallel when possible
- For renewal questions, default to 30 days if no timeframe specified
- For invoice questions, default to current month if no month specified
```

### 6.2 Tool Definitions

Each tool wraps a CLI command with `--json` output:

```typescript
// claude-skill/tools/subscriptions.ts
export const pax8_subscriptions_renewals = {
  name: "pax8_subscriptions_renewals",
  description: "List subscriptions approaching renewal, sorted by urgency. Shows company, product, quantity, renewal date, and term type.",
  parameters: {
    type: "object",
    properties: {
      within: {
        type: "string",
        description: "Time window for renewals, e.g. '7d', '14d', '30d', '90d'. Default: '30d'"
      },
      company: {
        type: "string",
        description: "Filter by company name or ID. Optional."
      }
    }
  },
  execute: async (params) => {
    const args = ["subscriptions", "renewals", "--json"];
    if (params.within) args.push("--within", params.within);
    if (params.company) args.push("--company", params.company);
    return execCli(args);
  }
};
```

Implement tool definitions for all 8 tools listed in skill.md.

---

## Build Order Summary

Execute in this exact order. Commit after each numbered item.

```
 1. Project scaffolding (monorepo, configs, dependencies)
 2. Core: types and Zod schemas for all API entities
 3. Core: token manager + credential store + auth tests
 4. Core: base HTTP client with retry/rate-limit/pagination
 5. Core: companies API + tests
 6. Core: subscriptions API + tests
 7. Core: products API + tests
 8. Core: invoices API + tests
 9. Core: orders, contacts, usage, quotes, webhooks APIs + tests
10. Core: demo data + mock client
11. Core: config schema + loader
12. Core: renewal tracker service + tests
13. Core: invoice auditor service + tests
14. Core: analytics service + tests
15. Core: cache service + tests
16. Core: bulk executor + tests
17. CLI: entry point, program setup, global options
18. CLI: lib utilities (output, spinner, errors, formatters, confirm, context)
19. CLI: lib utility tests
20. CLI: auth commands (login, status, logout) + tests
21. CLI: config commands (init, show, set, path) + tests
22. CLI: doctor + version + completions commands + tests
23. CLI: companies commands (list, show, create, update) + tests
24. CLI: subscriptions commands (list, show, update, cancel) + tests
25. CLI: subscriptions renewals command + tests
26. CLI: products commands (list, show, search) + tests
27. CLI: invoices commands (list, show, items, audit) + tests
28. CLI: orders commands (list, show, create) + tests
29. Core + CLI: telemetry module + instrumented action wrapper
30. E2E: onboarding flow test
31. E2E: subscription management flow test
32. E2E: billing workflow test
33. E2E: product discovery flow test
34. E2E: output format consistency tests
35. E2E: error handling flow tests
36. Claude skill: skill.md definition
37. Claude skill: tool definitions + execution wrapper
38. Final: coverage report, lint fix, README update with actual install instructions
```

---

## Quality Checklist (verify before declaring MVP complete)

- [ ] `pnpm install && pnpm build` succeeds from clean clone
- [ ] `pnpm test` passes with 80%+ coverage on core, 70%+ on CLI
- [ ] All 6 E2E user flow tests pass in demo mode
- [ ] `pax8 --help` shows organized command groups with descriptions
- [ ] Every command has `--help` with examples
- [ ] Every command supports `--json`, `--csv`, `--quiet`
- [ ] Piped output (non-TTY) defaults to JSON automatically
- [ ] Errors show causes and recovery steps, never raw stack traces
- [ ] `pax8 doctor` validates auth, config, connectivity, and reports issues
- [ ] Demo mode works for every command without any API credentials
- [ ] `pax8 auth login --client-id X --client-secret Y` stores credentials securely
- [ ] `pax8 subscriptions renewals --within 14d` produces the renewal report shown in the PRD
- [ ] `pax8 invoices audit` produces the audit report shown in the PRD
- [ ] Shell completions generate correctly for bash, zsh, fish
- [ ] No TypeScript errors, no ESLint warnings
- [ ] All commits are clean, focused, and have descriptive messages
- [ ] Claude skill installs and tool definitions are syntactically valid
- [ ] Telemetry is opt-in, disabled by default, respects DO_NOT_TRACK
- [ ] No secrets, tokens, or customer data appear in any log output
- [ ] Package can be published to npm (`npm pack` produces valid tarball)
