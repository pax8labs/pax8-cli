# Autonomous Build Prompt — pax8-cli MVP

You are building `pax8-cli`, an open-source CLI for MSPs to manage Pax8 cloud marketplace operations.

**Read `docs/PRD.md` for full product context. This document is your execution plan.**

---

## Operating Rules

1. **Never ask questions.** Make the simpler choice. Document decisions in commit messages.
2. **Never ask for permission.** Create files, install packages, run commands, and commit freely.
3. **Test before committing.** Run `pnpm build && pnpm test` before every commit. If tests fail, fix them before committing.
4. **If something breaks, fix it.** Don't stop to ask. Diagnose, fix, re-test, commit.
5. **Commit after each numbered build step.** Small, focused commits.
6. **No placeholders or TODO comments.** Everything you build must be complete and functional.
7. **Demo mode from step 1.** Every command works with `PAX8_DEMO=1` using realistic mock data.
8. **Follow patterns exactly.** Once a pattern is established, replicate it identically for all similar code.
9. **Skip keytar for MVP.** Use env vars + file storage only. Keytar requires native compilation that complicates setup. Add it later.
10. **Use Node 20+ built-in fetch.** No undici dependency needed.

---

## Phase 1: Project Scaffolding

### Step 1: Monorepo setup

Create the following files exactly:

**`pnpm-workspace.yaml`**
```yaml
packages:
  - "packages/*"
```

**`package.json`** (root)
```json
{
  "name": "pax8-cli-monorepo",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint 'packages/*/src/**/*.ts'",
    "format": "prettier --write 'packages/*/src/**/*.ts'"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^3.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.4.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**`tsconfig.json`** (root base)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

**`vitest.config.ts`**
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.test.ts", "**/mock/**"],
    },
  },
});
```

**`.gitignore`**
```
node_modules/
dist/
.pax8/
.env
*.tgz
coverage/
.turbo/
```

**`.prettierrc`**
```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

**`packages/core/package.json`**
```json
{
  "name": "@pax8/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "dev": "tsup src/index.ts --format esm --dts --watch"
  },
  "dependencies": {
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "typescript": "^5.7.0"
  }
}
```

**`packages/core/tsconfig.json`**
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*.ts"]
}
```

**`packages/core/src/index.ts`** — empty barrel export for now:
```typescript
export {};
```

**`packages/cli/package.json`**
```json
{
  "name": "@pax8/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "pax8": "./dist/index.js" },
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsup src/index.ts --format esm --clean --banner.js '#!/usr/bin/env node'",
    "dev": "tsup src/index.ts --format esm --watch --banner.js '#!/usr/bin/env node'"
  },
  "dependencies": {
    "@pax8/core": "workspace:*",
    "chalk": "^5.4.0",
    "cli-table3": "^0.6.5",
    "commander": "^13.0.0",
    "ora": "^8.1.0",
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "typescript": "^5.7.0",
    "@types/cli-table3": "^0.6.0"
  }
}
```

**`packages/cli/tsconfig.json`**
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*.ts"]
}
```

**`packages/cli/src/index.ts`** — minimal entry point:
```typescript
#!/usr/bin/env node
console.log("pax8 cli - coming soon");
```

**`packages/claude-skill/package.json`**
```json
{
  "name": "@pax8/claude-skill",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": { "build": "echo 'no build step yet'" }
}
```

After creating all files, run:
```bash
pnpm install
pnpm build
```

Verify both succeed, then commit: `"chore: scaffold monorepo with core, cli, and claude-skill packages"`

---

## Phase 2: Core Package

### Step 2: Zod schemas for all Pax8 API entities

Create `packages/core/src/api/types.ts` with complete Zod schemas for every entity. These schemas reflect the actual Pax8 API response format (verified against their docs and community SDKs).

**IMPORTANT:** Use `.passthrough()` on all top-level entity schemas so unknown fields from the API don't cause validation failures. Use `.optional()` generously — the API returns different fields depending on context.

```typescript
// packages/core/src/api/types.ts
import { z } from "zod";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const SubscriptionStatusSchema = z.enum([
  "Active", "Cancelled", "PendingManual", "PendingAutomated",
  "PendingCancel", "WaitingForDetails", "Trial", "Converted",
  "Inactive", "Deleted",
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const BillingTermSchema = z.enum([
  "Monthly", "Annual", "2 Year", "3 Year", "One-Time", "Trial", "Activation",
]);
export type BillingTerm = z.infer<typeof BillingTermSchema>;

export const InvoiceStatusSchema = z.enum([
  "Unpaid", "Paid", "Void", "Carried", "Nothing Due",
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const CompanyStatusSchema = z.enum(["Active", "Inactive", "Deleted"]);
export type CompanyStatus = z.infer<typeof CompanyStatusSchema>;

export const ContactTypeSchema = z.enum(["Admin", "Billing", "Technical"]);
export type ContactType = z.infer<typeof ContactTypeSchema>;

// ─── Pagination ──────────────────────────────────────────────────────────────

export const PageInfoSchema = z.object({
  size: z.number(),
  totalElements: z.number(),
  totalPages: z.number(),
  number: z.number(),
});
export type PageInfo = z.infer<typeof PageInfoSchema>;

export function PaginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    content: z.array(itemSchema),
    page: PageInfoSchema,
  });
}

// ─── Address ─────────────────────────────────────────────────────────────────

export const AddressSchema = z.object({
  street: z.string().optional(),
  street2: z.string().optional(),
  city: z.string().optional(),
  stateOrProvince: z.string().optional(),
  postcode: z.string().optional(),
  country: z.string().optional(),
}).passthrough();
export type Address = z.infer<typeof AddressSchema>;

// ─── Company ─────────────────────────────────────────────────────────────────

export const CompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  address: AddressSchema.optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  status: CompanyStatusSchema.optional(),
  billOnBehalfOfEnabled: z.boolean().optional(),
  selfServiceAllowed: z.boolean().optional(),
  orderApprovalRequired: z.boolean().optional(),
  externalId: z.string().nullable().optional(),
  created: z.string().optional(),
  modified: z.string().optional(),
}).passthrough();
export type Company = z.infer<typeof CompanySchema>;

export const CreateCompanyInputSchema = z.object({
  name: z.string(),
  address: AddressSchema.optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  externalId: z.string().optional(),
});
export type CreateCompanyInput = z.infer<typeof CreateCompanyInputSchema>;

export const UpdateCompanyInputSchema = CreateCompanyInputSchema.partial();
export type UpdateCompanyInput = z.infer<typeof UpdateCompanyInputSchema>;

// ─── Contact ─────────────────────────────────────────────────────────────────

export const ContactTypeEntrySchema = z.object({
  type: ContactTypeSchema,
  primary: z.boolean().optional(),
});

export const ContactSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  phoneCountryCode: z.string().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
  companyId: z.string(),
  types: z.array(ContactTypeEntrySchema).optional(),
  createdDate: z.string().optional(),
}).passthrough();
export type Contact = z.infer<typeof ContactSchema>;

export const CreateContactInputSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  types: z.array(ContactTypeEntrySchema).optional(),
});
export type CreateContactInput = z.infer<typeof CreateContactInputSchema>;

// ─── Product ─────────────────────────────────────────────────────────────────

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  vendorName: z.string().optional(),
  vendor: z.string().optional(),
  sku: z.string().optional(),
  vendorSku: z.string().optional(),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  unitOfMeasurement: z.string().optional(),
  categoryName: z.string().optional(),
}).passthrough();
export type Product = z.infer<typeof ProductSchema>;

export const ProductPricingRateSchema = z.object({
  partnerBuyRate: z.number(),
  suggestedRetailPrice: z.number(),
  startQuantityRange: z.number().optional(),
  chargeType: z.string().optional(),
});

export const ProductPricingSchema = z.object({
  billingTerm: z.string(),
  type: z.string().optional(),
  unitOfMeasurement: z.string().optional(),
  productId: z.string().optional(),
  productName: z.string().optional(),
  rates: z.array(ProductPricingRateSchema),
}).passthrough();
export type ProductPricing = z.infer<typeof ProductPricingSchema>;

// ─── Subscription ────────────────────────────────────────────────────────────

export const CommitmentSchema = z.object({
  id: z.string().optional(),
  term: z.string().optional(),
  endDate: z.string().optional(),
}).passthrough();
export type Commitment = z.infer<typeof CommitmentSchema>;

export const SubscriptionSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  productId: z.string(),
  quantity: z.number(),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  createdDate: z.string(),
  billingStart: z.string().optional(),
  status: SubscriptionStatusSchema,
  price: z.number().optional(),
  billingTerm: z.string().optional(),
  commitment: CommitmentSchema.optional(),
  commitmentTermEndDate: z.string().nullable().optional(),
  vendorSubscriptionId: z.string().nullable().optional(),
  companyName: z.string().optional(),
  productName: z.string().optional(),
}).passthrough();
export type Subscription = z.infer<typeof SubscriptionSchema>;

export const UpdateSubscriptionInputSchema = z.object({
  quantity: z.number().int().min(1).optional(),
  billingTerm: BillingTermSchema.optional(),
  price: z.number().optional(),
  startDate: z.string().optional(),
});
export type UpdateSubscriptionInput = z.infer<typeof UpdateSubscriptionInputSchema>;

// ─── Order ───────────────────────────────────────────────────────────────────

export const OrderLineItemSchema = z.object({
  id: z.string().optional(),
  offerId: z.string().optional(),
  productId: z.string(),
  subscriptionId: z.string().optional(),
  lineItemNumber: z.number().int().optional(),
  quantity: z.number(),
  billingTerm: z.string().optional(),
  commitmentTermId: z.string().optional(),
  provisionStartDate: z.string().optional(),
  provisioningDetails: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export type OrderLineItem = z.infer<typeof OrderLineItemSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  orderedBy: z.string().optional(),
  orderedByUserId: z.string().optional(),
  orderedByUserEmail: z.string().optional(),
  createdDate: z.string(),
  lineItems: z.array(OrderLineItemSchema).optional(),
}).passthrough();
export type Order = z.infer<typeof OrderSchema>;

export const CreateOrderInputSchema = z.object({
  companyId: z.string(),
  lineItems: z.array(z.object({
    productId: z.string(),
    quantity: z.number().int().min(1),
    billingTerm: BillingTermSchema.optional(),
    provisioningDetails: z.record(z.string(), z.unknown()).optional(),
  })),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;

// ─── Invoice ─────────────────────────────────────────────────────────────────

export const InvoiceSchema = z.object({
  id: z.string(),
  companyId: z.string().nullable().optional(),
  invoiceDate: z.string(),
  dueDate: z.string(),
  status: InvoiceStatusSchema,
  total: z.number(),
  balance: z.number(),
  carriedBalance: z.number().optional(),
  partnerName: z.string().optional(),
  externalId: z.string().nullable().optional(),
  companyName: z.string().optional(),
}).passthrough();
export type Invoice = z.infer<typeof InvoiceSchema>;

export const InvoiceItemSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  type: z.string().optional(),
  companyId: z.string().optional(),
  companyName: z.string().optional(),
  productId: z.string(),
  productName: z.string().optional(),
  subscriptionId: z.string().optional(),
  startPeriod: z.string().optional(),
  endPeriod: z.string().optional(),
  term: z.string().optional(),
  sku: z.string().optional(),
  description: z.string().optional(),
  quantity: z.number(),
  unitOfMeasure: z.string().optional(),
  rateType: z.string().optional(),
  chargeType: z.string().optional(),
  price: z.number().optional(),
  unitPrice: z.number().optional(),
  subTotal: z.number().optional(),
  cost: z.number().optional(),
  costTotal: z.number().optional(),
  total: z.number().optional(),
  billingFee: z.number().optional(),
  billingFeeRate: z.number().optional(),
  amountDue: z.number().optional(),
  offeredBy: z.string().optional(),
  vendorName: z.string().optional(),
  currencyCode: z.string().optional(),
  billedByPax8: z.boolean().optional(),
}).passthrough();
export type InvoiceItem = z.infer<typeof InvoiceItemSchema>;

// ─── Usage ───────────────────────────────────────────────────────────────────

export const UsageSummarySchema = z.object({
  id: z.string(),
  companyId: z.string(),
  productId: z.string(),
  subscriptionId: z.string().optional(),
  date: z.string(),
  billingMonth: z.string().optional(),
  quantity: z.number(),
  unitPrice: z.number(),
  subtotal: z.number(),
  totalCost: z.number().optional(),
  status: z.string().optional(),
  resourceGroup: z.string().optional(),
  companyName: z.string().optional(),
  productName: z.string().optional(),
}).passthrough();
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

export const UsageLineSchema = z.object({
  id: z.string(),
  usageSummaryId: z.string(),
  productId: z.string().optional(),
  quantity: z.number(),
  unitOfMeasurement: z.string().optional(),
  unitPrice: z.number().optional(),
  ratePerUnit: z.number().optional(),
  subtotal: z.number().optional(),
  lineTotal: z.number().optional(),
  description: z.string().optional(),
  date: z.string(),
  resourceId: z.string().optional(),
  summaryKey: z.string().optional(),
  summaryDisplayName: z.string().optional(),
}).passthrough();
export type UsageLine = z.infer<typeof UsageLineSchema>;

// ─── Auth ────────────────────────────────────────────────────────────────────

export const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

// ─── Errors ──────────────────────────────────────────────────────────────────

export const ApiErrorResponseSchema = z.object({
  type: z.string().optional(),
  message: z.string(),
  instance: z.string().optional(),
  status: z.number().optional(),
  details: z.array(z.object({
    type: z.string().optional(),
    status: z.number().optional(),
    message: z.string(),
    instance: z.string().optional(),
    supportId: z.string().optional(),
  })).optional(),
}).passthrough();
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
```

Export everything from `packages/core/src/index.ts`:
```typescript
export * from "./api/types.js";
```

Build and test, then commit: `"feat(core): add Zod schemas for all Pax8 API entities"`

### Step 3: Auth module

Create `packages/core/src/auth/token-manager.ts`:

- Constructor takes `{ clientId: string; clientSecret: string }`
- `getToken()` — if cached token is valid (check `expiresAt`), return it. Otherwise call `POST https://api.pax8.com/v1/token` with `{ client_id, client_secret, grant_type: "client_credentials", audience: "https://api.pax8.com" }` as `application/json` body
- Parse response with `TokenResponseSchema`
- Cache `access_token` and compute `expiresAt = Date.now() + (expires_in - 300) * 1000` (refresh 5 min early)
- `isAuthenticated()` — returns true if token exists and not expired
- `clearToken()` — clears cached token
- On auth failure, throw a typed `AuthError` that extends `Error` with `statusCode` and `responseBody` fields

Create `packages/core/src/auth/credential-store.ts`:

- `getCredentials()` — check in order: (1) `PAX8_CLIENT_ID` + `PAX8_CLIENT_SECRET` env vars, (2) `~/.pax8/credentials.json` file. Return `{ clientId, clientSecret }` or throw `CredentialError`
- `saveCredentials(clientId, clientSecret)` — write to `~/.pax8/credentials.json` with `0o600` permissions. Create `~/.pax8/` dir if needed.
- `clearCredentials()` — delete `~/.pax8/credentials.json` if it exists
- `hasCredentials()` — returns boolean

Create `packages/core/src/auth/errors.ts`:
```typescript
export class AuthError extends Error {
  constructor(message: string, public statusCode?: number, public responseBody?: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}
```

Write unit tests in `packages/core/src/__tests__/auth/`:
- `token-manager.test.ts` — mock `global.fetch` to test: successful token fetch, cached token reuse, token refresh on expiry, 401 error handling, network error handling
- `credential-store.test.ts` — test env var priority, file fallback, save/clear operations. Use a temp directory (not real `~/.pax8/`).

Export from index. Build, test, commit: `"feat(core): add token manager and credential store with auth tests"`

### Step 4: Base HTTP client

Create `packages/core/src/api/client.ts`:

```typescript
export interface Pax8ClientOptions {
  tokenManager: TokenManager;
  baseUrl?: string; // default: "https://api.pax8.com/v1"
  timeout?: number; // default: 30000
  debug?: boolean;  // default: process.env.PAX8_DEBUG === "1"
}

export class Pax8Client {
  // All methods auto-inject Authorization header via tokenManager.getToken()
  // All methods validate responses with provided Zod schema
  // All methods retry on 429 (read Retry-After header, default 60s wait) up to 3 times
  // All methods retry on 5xx with exponential backoff (1s, 2s, 4s) up to 3 times
  // If debug=true, log request method+url+status to stderr

  async get<T>(path: string, params?: Record<string, string | number | undefined>, schema?: z.ZodType<T>): Promise<T>
  async post<T>(path: string, body: unknown, schema?: z.ZodType<T>): Promise<T>
  async put<T>(path: string, body: unknown, schema?: z.ZodType<T>): Promise<T>
  async patch<T>(path: string, body: unknown, schema?: z.ZodType<T>): Promise<T>
  async delete(path: string): Promise<void>

  // Pagination helper: fetches all pages and returns combined content array
  async getAllPages<T>(path: string, params?: Record<string, string | number | undefined>, itemSchema?: z.ZodType<T>): Promise<T[]>
}
```

Create `packages/core/src/api/errors.ts`:
```typescript
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public path: string,
    public responseBody?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class RateLimitError extends ApiError {
  constructor(public retryAfterMs: number, path: string) {
    super(`Rate limited on ${path}. Retry after ${retryAfterMs}ms`, 429, path);
    this.name = "RateLimitError";
  }
}
```

Tests: mock `global.fetch` to test successful requests, pagination (2 pages), 429 retry, 5xx retry, timeout, Zod validation failure.

Build, test, commit: `"feat(core): add HTTP client with retry, rate-limit handling, and pagination"`

### Step 5-8: API resource modules

Create one file per resource in `packages/core/src/api/`. Each follows this exact pattern:

```typescript
// packages/core/src/api/companies.ts
import { Pax8Client } from "./client.js";
import {
  CompanySchema, Company, CreateCompanyInput, UpdateCompanyInput,
  PaginatedSchema, PageInfo,
} from "./types.js";

export interface CompanyListParams {
  page?: number;
  size?: number;
}

export class CompaniesApi {
  constructor(private client: Pax8Client) {}

  async list(params?: CompanyListParams) {
    return this.client.get("/companies", params as Record<string, string | number>, PaginatedSchema(CompanySchema));
  }

  async get(id: string) {
    return this.client.get(`/companies/${id}`, undefined, CompanySchema);
  }

  async create(data: CreateCompanyInput) {
    return this.client.post("/companies", data, CompanySchema);
  }

  async update(id: string, data: UpdateCompanyInput) {
    return this.client.patch(`/companies/${id}`, data, CompanySchema);
  }
}
```

**Step 5:** `companies.ts` + tests → commit `"feat(core): add companies API module"`
**Step 6:** `subscriptions.ts` (list, get, getHistory, update, cancel/delete) + tests → commit `"feat(core): add subscriptions API module"`
**Step 7:** `products.ts` (list, get, getPricing, getProvisioningDetails, getDependencies) + tests → commit `"feat(core): add products API module"`
**Step 8:** `invoices.ts` (list, get, listItems, listDraftItems) + tests → commit `"feat(core): add invoices API module"`

For subscriptions, the list endpoint supports these query params: `companyId`, `productId`, `status` (comma-separated), `page`, `size`.
For invoices, list supports: `status`, `invoiceDateStart`, `invoiceDateEnd`, `page`, `size`.
For invoice items: `invoiceId`, `invoiceDateStart`, `invoiceDateEnd`, `page`, `size`.

### Step 9: Remaining API modules

Create all at once: `orders.ts`, `contacts.ts`, `usage.ts`, `quotes.ts`, `webhooks.ts`. Follow the same pattern. Each gets basic tests.

Contacts are nested: `GET /companies/{companyId}/contacts`, etc.

Commit: `"feat(core): add orders, contacts, usage, quotes, and webhooks API modules"`

### Step 10: Demo data and mock client

Create `packages/core/src/mock/demo-data.ts` with these exact entities:

**Companies (5):**
```typescript
export const DEMO_COMPANIES: Company[] = [
  {
    id: "c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c",
    name: "Acme Corp",
    status: "Active",
    address: { city: "Denver", stateOrProvince: "CO", country: "US" },
    phone: "303-555-0100",
    website: "https://acmecorp.com",
  },
  {
    id: "d2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d",
    name: "Contoso Ltd",
    status: "Active",
    address: { city: "Seattle", stateOrProvince: "WA", country: "US" },
    phone: "206-555-0200",
    website: "https://contoso.com",
  },
  {
    id: "e3c4d5e6-f7a8-4b9c-0d1e-2f3a4b5c6d7e",
    name: "Fabrikam Inc",
    status: "Active",
    address: { city: "Austin", stateOrProvince: "TX", country: "US" },
    phone: "512-555-0300",
  },
  {
    id: "f4d5e6f7-a8b9-4c0d-1e2f-3a4b5c6d7e8f",
    name: "Northwind Traders",
    status: "Active",
    address: { city: "Portland", stateOrProvince: "OR", country: "US" },
  },
  {
    id: "a5e6f7a8-b9c0-4d1e-2f3a-4b5c6d7e8f9a",
    name: "Woodgrove Bank",
    status: "Active",
    address: { city: "Chicago", stateOrProvince: "IL", country: "US" },
    phone: "312-555-0500",
  },
];
```

**Products (8):** Use real Pax8 product names. Give each a unique UUID.
- Microsoft 365 Business Basic ($6.00/user/mo)
- Microsoft 365 Business Premium ($22.00/user/mo)
- Microsoft 365 E3 ($36.00/user/mo)
- Microsoft Defender for Business ($3.00/user/mo)
- SentinelOne Singularity Complete ($5.50/endpoint/mo)
- Acronis Cyber Protect Cloud ($1.50/GB/mo)
- Huntress Managed EDR ($4.00/agent/mo)
- Datto SaaS Protection ($3.50/user/mo)

**Subscriptions (18):** Spread across the 5 companies. Mix of:
- Monthly and Annual billing terms
- Various quantities (5 to 150)
- Some with `commitmentTermEndDate` within 7 days, 14 days, 30 days of "now" (use relative dates computed from `Date.now()`)
- Most status "Active", one "PendingCancel", one "Trial"
- Include `companyName` and `productName` on each for easy display

**Invoices (3):** For the current month and previous 2 months. Each with:
- Realistic totals ($500-$15,000 range)
- Status: current month "Unpaid", previous months "Paid"

**Invoice Items (25-30):** Line items for the 3 invoices.
- Most match subscription quantities exactly
- **3 deliberate discrepancies for audit testing:**
  - Acme Corp M365 Business Premium: invoiced 50 seats but subscription has 45 (overcharge)
  - Contoso Exchange Online: invoiced 10 but subscription has 12 (undercharge)
  - Fabrikam Azure AD Premium: invoiced 0 but subscription has 5 (missing)

Create `packages/core/src/mock/mock-client.ts`:
- Class `MockPax8Client` that implements the same interface as resource API classes
- Has `companies`, `subscriptions`, `products`, `invoices`, `orders`, `contacts`, `usage`, `webhooks` properties that return mock data
- Supports filtering: `companies.list()` returns paginated demo data, `subscriptions.list({ companyId })` filters correctly
- Simulates pagination: if `size=10` and there are 18 subscriptions, return proper `page.totalPages=2`
- No artificial latency in test mode

Export from core index. Build, test, commit: `"feat(core): add demo data and mock client for all API resources"`

### Step 11: Config module

Create `packages/core/src/config/schema.ts` with the Zod config schema from the PRD.
Create `packages/core/src/config/loader.ts`:
- `loadConfig(configPath?: string)` — reads YAML from `~/.pax8/config.yaml` (or provided path), validates with Zod, returns typed config
- `saveConfig(config, configPath?)` — writes YAML
- `getConfigDir()` — returns `~/.pax8`
- `ensureConfigDir()` — creates dir if missing
- Returns defaults if no config file exists (don't error)

Tests with temp directories. Build, test, commit: `"feat(core): add config schema and loader"`

### Steps 12-16: Services

Build each service with unit tests. Each service is a pure module with functions that operate on typed data — no API calls inside services.

**Step 12: `renewal-tracker.ts`**
```typescript
export interface RenewalItem {
  subscriptionId: string;
  companyId: string;
  companyName: string;
  productName: string;
  quantity: number;
  billingTerm: string;
  renewalDate: string;     // ISO 8601
  daysUntilRenewal: number;
  isAnnual: boolean;
  mrrAtRisk: number;       // price * quantity
}

export interface RenewalReport {
  items: RenewalItem[];
  totalMrrAtRisk: number;
  urgentCount: number;     // renewing within 14 days
  annualCount: number;     // annual terms (higher risk)
}

export function getUpcomingRenewals(
  subscriptions: Subscription[],
  withinDays: number,
  now?: Date, // injectable for testing
): RenewalReport
```

Use `commitment.endDate` if available, fall back to `commitmentTermEndDate`, fall back to `endDate`. Skip subscriptions without any end date. Sort by `daysUntilRenewal` ascending.

Tests: various mixes of dates, annual vs monthly, edge cases. Commit: `"feat(core): add renewal tracker service"`

**Step 13: `invoice-auditor.ts`**
```typescript
export interface AuditDiscrepancy {
  companyName: string;
  productName: string;
  invoicedQuantity: number;
  activeQuantity: number;
  quantityDelta: number;
  dollarImpact: number;
  type: "overcharge" | "undercharge" | "missing" | "unexpected";
}

export interface AuditReport {
  discrepancies: AuditDiscrepancy[];
  totalOvercharge: number;
  totalUndercharge: number;
  clean: boolean;
}

export function auditInvoices(
  invoiceItems: InvoiceItem[],
  subscriptions: Subscription[],
): AuditReport
```

Match invoice items to subscriptions by `subscriptionId` or `productId + companyId`. Commit: `"feat(core): add invoice auditor service"`

**Step 14: `analytics.ts`**
```typescript
export interface MrrByDimension { name: string; mrr: number; subscriptionCount: number; }
export interface MrrReport { total: number; byCompany: MrrByDimension[]; byProduct: MrrByDimension[]; byVendor: MrrByDimension[]; }

export function computeMrr(subscriptions: Subscription[]): MrrReport
```
MRR = sum of `price * quantity` for active subscriptions. For annual billing, divide by 12. Commit: `"feat(core): add analytics service"`

**Step 15: `cache.ts`** — file-based cache with TTL. Uses `~/.pax8/cache/` directory. JSON files with `{ data, expiresAt }` wrapper. Commit: `"feat(core): add file-based cache service"`

**Step 16: `bulk-executor.ts`** — parallel execution with concurrency limit. Uses a simple semaphore pattern. Commit: `"feat(core): add bulk executor with rate-limit awareness"`

---

## Phase 3: CLI Package

### Step 17: Entry point and program structure

Create `packages/cli/src/index.ts`:
```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Read version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
let version = "0.1.0";
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
  version = pkg.version;
} catch {}

const program = new Command()
  .name("pax8")
  .description("CLI for managing Pax8 cloud marketplace operations")
  .version(version)
  .option("--json", "Output as JSON")
  .option("--csv", "Output as CSV")
  .option("--quiet", "Suppress all output except errors")
  .option("--verbose", "Show detailed output including API calls")
  .option("--no-color", "Disable colored output");

// Register command groups (add as they're built)
// program.addCommand(authCommand);
// program.addCommand(companiesCommand);
// etc.

program.parse();
```

Build and verify `node packages/cli/dist/index.js --help` works. Commit: `"feat(cli): add entry point with global options"`

### Step 18: CLI library utilities

Create all lib files in `packages/cli/src/lib/`:

**`output.ts`** — The core output engine. Must handle table, JSON, CSV, and quiet modes.

For tables, use `cli-table3`. Define a `Column` interface: `{ key: string; header: string; formatter?: (val: any) => string; align?: "left" | "right" }`.

For CSV: escape fields containing commas or quotes. Use double-quote escaping.

The `output()` function signature:
```typescript
export function output(data: unknown[], options: {
  format: "table" | "json" | "csv" | "quiet";
  columns: Column[];
}): void
```

For table format, print to stdout. For JSON, `JSON.stringify(data, null, 2)`. For CSV, header row + data rows. For quiet, nothing.

**`spinner.ts`** — wrap ora. Disable if `--quiet`, `--json`, `--csv`, or non-TTY. Use stderr stream.

**`errors.ts`** — `CliError` class with causes and recovery steps. `handleCommandError()` that formats nicely and calls `process.exit()`.

**`formatters.ts`** — all the formatting functions from the PRD. `formatCurrency` takes a number (dollars, not cents) and returns `"$1,234.56"`. `formatDaysUntil` returns `"today"`, `"tomorrow"`, `"in 6 days"`, `"in 2 months"`.

**`confirm.ts`** — uses `readline` from Node stdlib. `confirm()` for yes/no, `confirmDestructive()` for typing a keyword. In non-TTY or `--yes` flag, auto-confirm.

**`context.ts`** — the key integration point:
```typescript
export interface CommandContext {
  config: Config;
  api: {
    companies: CompaniesApi;
    subscriptions: SubscriptionsApi;
    products: ProductsApi;
    invoices: InvoicesApi;
    orders: OrdersApi;
    contacts: ContactsApi;
    usage: UsageApi;
  };
  outputFormat: "table" | "json" | "csv" | "quiet";
  isDemo: boolean;
  verbose: boolean;
}

export async function buildContext(options: Record<string, unknown>): Promise<CommandContext>
```

This function checks for `PAX8_DEMO=1` env var. If demo mode, it creates a `MockPax8Client`. Otherwise, it loads credentials, creates `TokenManager`, creates `Pax8Client`, and builds real API instances.

Detect output format: `--json` → json, `--csv` → csv, `--quiet` → quiet, otherwise check `process.stdout.isTTY` (non-TTY defaults to json), otherwise table.

Commit: `"feat(cli): add output, spinner, error, formatter, confirm, and context utilities"`

### Step 19: Utility tests

Write unit tests for all lib modules. Test formatters thoroughly (edge cases). Test output in all 4 modes. Test context builder in demo mode.

Commit: `"test(cli): add unit tests for all CLI utility modules"`

### Steps 20-28: Commands

Each step creates a command group with all subcommands and integration tests.

**The command file pattern** (follow exactly for every command):

```typescript
import { Command } from "commander";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";

export const listCommand = new Command("list")
  .description("List all companies")
  .option("--page <number>", "Page number (starts at 0)", parseInt)
  .option("--size <number>", "Results per page", parseInt)
  .addHelpText("after", "\nExamples:\n  pax8 companies list\n  pax8 companies list --json\n  pax8 companies list --csv > companies.csv")
  .action(async function (this: Command) {
    // Access parent options (--json, --csv, etc.) via this.optsWithGlobals()
    const opts = this.optsWithGlobals();
    const spinner = createSpinner("Fetching companies...").start();
    try {
      const ctx = await buildContext(opts);
      const result = await ctx.api.companies.list({ page: opts.page, size: opts.size });
      spinner.stop();
      output(result.content, {
        format: ctx.outputFormat,
        columns: [
          { key: "name", header: "Name" },
          { key: "id", header: "ID" },
          { key: "status", header: "Status" },
        ],
      });
      if (ctx.outputFormat === "table") {
        console.log(`\n  ${result.page.totalElements} companies`);
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to list companies");
    }
  });
```

**Group commands** with a parent command:
```typescript
// packages/cli/src/commands/companies/index.ts
import { Command } from "commander";
import { listCommand } from "./list.js";
import { showCommand } from "./show.js";
// ...
export const companiesCommand = new Command("companies")
  .description("Manage companies");
companiesCommand.addCommand(listCommand);
companiesCommand.addCommand(showCommand);
// ...
```

**Integration test pattern** (every command gets at least 3 tests):
```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolve } from "path";

const exec = promisify(execFile);
const CLI = resolve(import.meta.dirname, "../../../dist/index.js");

async function run(args: string[], env?: Record<string, string>) {
  return exec("node", [CLI, ...args], {
    env: { ...process.env, PAX8_DEMO: "1", NO_COLOR: "1", ...env },
    timeout: 15000,
  });
}

describe("pax8 companies list", () => {
  it("shows companies in table format", async () => {
    const { stdout } = await run(["companies", "list"]);
    expect(stdout).toContain("Acme Corp");
    expect(stdout).toContain("5 companies");
  });

  it("outputs valid JSON with --json", async () => {
    const { stdout } = await run(["companies", "list", "--json"]);
    const data = JSON.parse(stdout);
    expect(data).toHaveLength(5);
    expect(data[0]).toHaveProperty("name");
  });

  it("outputs CSV with --csv", async () => {
    const { stdout } = await run(["companies", "list", "--csv"]);
    expect(stdout.split("\n")[0]).toContain("name");
  });

  it("shows help with examples", async () => {
    const { stdout } = await run(["companies", "list", "--help"]);
    expect(stdout).toContain("Examples:");
  });
});
```

**IMPORTANT:** Integration tests require a build first. Before running integration tests for CLI commands, the test setup must build the CLI. Add a `beforeAll` or a vitest setup file that runs `pnpm --filter @pax8/cli build`. Or: configure the test to use `tsx` to run the source directly instead of the compiled output. Choose whichever is simpler to get working — don't let this block you.

**Step 20: auth commands** — `auth login` (accepts `--client-id` and `--client-secret` flags, stores via credential store, tests token), `auth status` (shows masked credentials and token state), `auth logout` (clears). In demo mode, `auth login` with any credentials succeeds. Commit: `"feat(cli): add auth login, status, and logout commands"`

**Step 21: config commands** — `config init` (create default config.yaml), `config show` (print current config), `config set <key> <value>`, `config path`. Commit: `"feat(cli): add config init, show, set, and path commands"`

**Step 22: doctor, version, completions** — `doctor` checks: config exists, credentials present, can authenticate (in demo mode, always passes). `version` prints version. `completions` generates shell completion scripts. Commit: `"feat(cli): add doctor, version, and completions commands"`

**Step 23: companies** — list, show (with `--subscriptions` flag that fetches and displays subs), create, update. For `show`, support both UUID and name lookup (if not UUID format, search by name). Commit: `"feat(cli): add companies list, show, create, and update commands"`

**Step 24: subscriptions** — list (with `--company` filter supporting name or ID), show (with `--history`), update (with confirmation on quantity reduction), cancel (with destructive confirmation). Commit: `"feat(cli): add subscriptions list, show, update, and cancel commands"`

**Step 25: subscriptions renewals** — the high-value command. Uses `renewal-tracker` service. Default `--within 30d`. Output table with columns: Company, Product, Quantity, Renews, Term. Footer with summary warnings. Commit: `"feat(cli): add subscriptions renewals command"`

**Step 26: products** — list, show (with `--pricing`, `--provisioning`, `--dependencies`), search (filter by name containing search term). Commit: `"feat(cli): add products list, show, and search commands"`

**Step 27: invoices** — list (with `--month`, `--company`), show, items, audit (uses `invoice-auditor` service). Audit output matches the PRD example format exactly. Commit: `"feat(cli): add invoices list, show, items, and audit commands"`

**Step 28: orders** — list, show, create (with `--company`, `--product`, `--quantity` and `--dry-run`). Commit: `"feat(cli): add orders list, show, and create commands"`

---

## Phase 4: Telemetry

### Step 29: Telemetry module

Create `packages/core/src/telemetry/telemetry.ts`:
- `TelemetryCollector` class
- `isEnabled()` — check `PAX8_TELEMETRY_DISABLED`, `DO_NOT_TRACK` env vars, config setting. Default: disabled.
- `track(event: TelemetryEvent)` — buffer in memory
- `flush()` — write buffered events as JSONL to `~/.pax8/telemetry/YYYY-MM-DD.jsonl`
- No network calls in MVP — local only

Create `packages/cli/src/lib/instrumented-action.ts` — wrapper that times commands and records telemetry. Wrap all existing command actions with it.

Add `pax8 telemetry status/enable/disable` commands.

Commit: `"feat: add telemetry module with local-only event collection"`

---

## Phase 5: E2E Tests

### Steps 30-35: E2E user flow tests

Create `packages/cli/src/__tests__/e2e/` directory. Each test file exercises a complete user workflow in demo mode. These are subprocess tests that run the built CLI binary.

**Step 30:** `onboarding.test.ts` — doctor → auth login → auth status → companies list → companies show with subscriptions. Commit: `"test(e2e): add onboarding user flow test"`

**Step 31:** `subscription-management.test.ts` — subscriptions list → filter by company → show → show with history → renewals → renewals with tight window. Commit: `"test(e2e): add subscription management flow test"`

**Step 32:** `billing-workflow.test.ts` — invoices list → filter by month → items as CSV → audit with discrepancies. Commit: `"test(e2e): add billing workflow flow test"`

**Step 33:** `product-discovery.test.ts` — search → show with pricing → search with no results (should show helpful empty message, not error). Commit: `"test(e2e): add product discovery flow test"`

**Step 34:** `output-formats.test.ts` — for companies list, subscriptions list, and invoices list: verify table has headers, JSON is valid array, CSV has header row, quiet produces no stdout. Commit: `"test(e2e): add output format consistency tests"`

**Step 35:** `error-handling.test.ts` — nonexistent subcommand → helpful error, auth without credentials (non-demo, `PAX8_DEMO` unset) → auth error with recovery steps. Commit: `"test(e2e): add error handling flow tests"`

---

## Phase 6: Claude Skill

### Step 36: Skill definition

Create `packages/claude-skill/skill.md`:

```markdown
---
name: pax8
description: Manage Pax8 cloud marketplace — customers, subscriptions, invoices, renewals, products
---

You have tools to query Pax8 cloud marketplace data via the pax8 CLI. The CLI must be installed and authenticated (`pax8 auth login`).

## Guidelines

- Present data in clear summaries, not raw JSON dumps
- Proactively flag items needing attention (upcoming renewals, billing issues)
- Include totals and context with financial data
- For renewals, default to 30 days if no timeframe given
- For invoices, default to current month if no month given
- Call multiple tools in parallel when a question needs data from several sources

## Available Tools

All tools return JSON. Parse and summarize the results for the user.
```

Commit: `"feat(claude-skill): add skill definition"`

### Step 37: Tool definitions

Create `packages/claude-skill/src/tools.ts` with tool definitions for:
- `pax8_companies_list` — wraps `pax8 companies list --json`
- `pax8_companies_show` — wraps `pax8 companies show <id> --subscriptions --json`
- `pax8_subscriptions_list` — wraps `pax8 subscriptions list --json [--company <id>]`
- `pax8_subscriptions_renewals` — wraps `pax8 subscriptions renewals --json [--within <days>]`
- `pax8_invoices_list` — wraps `pax8 invoices list --json [--month <month>]`
- `pax8_invoices_audit` — wraps `pax8 invoices audit --json [--month <month>]`
- `pax8_products_search` — wraps `pax8 products search <query> --json`
- `pax8_report_subscriptions` — fetches `pax8 subscriptions list --json` (+ `companies list`) and computes a Pax8-cost rollup by company; returns wrapped `AmountCurrency` envelopes and the standard partner-revenue disclaimer.

Each tool: name, description, JSON Schema parameters, `execute` function that spawns the CLI as a child process and returns parsed JSON.

Create `packages/claude-skill/src/executor.ts` — shared `execCli(args: string[]): Promise<unknown>` function.

Commit: `"feat(claude-skill): add tool definitions for all major operations"`

---

## Phase 7: Polish

### Step 38: Final polish

1. Run `pnpm test:coverage` — verify core ≥80%, cli ≥70%. If below, add tests for uncovered lines.
2. Run `pnpm lint` — fix any lint errors.
3. Run `pnpm build` from a clean state — verify it succeeds.
4. Test `node packages/cli/dist/index.js --help` — verify organized output.
5. Test `node packages/cli/dist/index.js doctor` in demo mode — should pass.
6. Test `node packages/cli/dist/index.js companies list --json | node -e "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))"` — verify valid JSON.
7. Update `README.md` with actual install/build instructions for contributors.
8. Verify the quality checklist below.

Commit: `"chore: final polish — coverage, lint, README update"`

---

## Quality Checklist

Run through every item before declaring MVP complete. Fix anything that fails.

- [ ] `pnpm install && pnpm build` succeeds from clean clone
- [ ] `pnpm test` all tests pass
- [ ] `pnpm test:coverage` — core ≥80%, cli ≥70%
- [ ] All 6 E2E user flow tests pass
- [ ] `pax8 --help` shows organized command groups
- [ ] Every command has `--help` with examples
- [ ] Every list command supports `--json`, `--csv`, `--quiet`
- [ ] Piped output (non-TTY) defaults to JSON
- [ ] Errors show causes + recovery steps, never stack traces
- [ ] `pax8 doctor` passes in demo mode
- [ ] Demo mode works for every command without credentials
- [ ] `pax8 subscriptions renewals --within 14d` shows renewal report with company/product/quantity/date
- [ ] `pax8 invoices audit` shows discrepancies with dollar amounts
- [ ] No TypeScript errors
- [ ] No secrets/tokens in any log output
- [ ] Telemetry disabled by default, respects `DO_NOT_TRACK`
- [ ] Claude skill has valid tool definitions
