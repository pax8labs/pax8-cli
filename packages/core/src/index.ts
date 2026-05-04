// Public entrypoint for `@pax8/core`.
//
// This file is the single source of truth for what `@pax8/core` exposes to
// external consumers. Re-exports are explicit (no `export *`) so that adding
// a new file under `src/` does not silently grow the public surface.
//
// Anything intentionally kept exported but not part of the documented public
// API (because the CLI in this repo depends on it) is marked with `@internal`
// JSDoc on its declaration. With `stripInternal: true` enabled in tsconfig,
// those symbols still exist at runtime for the CLI but are stripped from the
// generated `dist/index.d.ts` so external TypeScript consumers don't see them
// in IDE autocomplete.

// ─── API client + per-resource sub-clients ──────────────────────────────────

export { Pax8Client } from "./api/client.js";
export type { Pax8ClientOptions } from "./api/client.js";
export { CompaniesApi } from "./api/companies.js";
export { ContactsApi } from "./api/contacts.js";
export { ProductsApi } from "./api/products.js";
export { OrdersApi } from "./api/orders.js";
export { SubscriptionsApi } from "./api/subscriptions.js";
export { InvoicesApi } from "./api/invoices.js";
export { UsageApi } from "./api/usage.js";
export { QuotesApi } from "./api/quotes.js";
export { WebhooksApi } from "./api/webhooks.js";

// ─── API constants ──────────────────────────────────────────────────────────

export { ALL_SUBS_PAGE_SIZE } from "./api/constants.js";

// ─── API error classes ──────────────────────────────────────────────────────

export {
  ApiError,
  AuthError,
  RateLimitError,
  NotFoundError,
  ValidationError,
} from "./api/errors.js";
export type { FieldError } from "./api/errors.js";

// ─── Machine-readable error codes ───────────────────────────────────────────

export {
  ERROR_AUTH_EXPIRED,
  ERROR_AUTH_MISSING,
  ERROR_COMPANY_NOT_FOUND,
  ERROR_PRODUCT_NOT_FOUND,
  ERROR_SUBSCRIPTION_NOT_FOUND,
  ERROR_RATE_LIMITED,
  ERROR_API_TIMEOUT,
  ERROR_API_VALIDATION,
  ERROR_INVALID_INPUT,
  ERROR_NOT_AUTHORIZED,
  ERROR_INTERNAL,
} from "./errors/codes.js";
export type { Pax8ErrorCode } from "./errors/codes.js";

// ─── Domain types & Zod schemas ─────────────────────────────────────────────
//
// Schemas are runtime values (zod objects) so they must use a value re-export.
// Pure type aliases use `export type` so consumers that only need types don't
// pull in the runtime.

export {
  // Schemas
  AddressSchema,
  CompanySchema,
  CreateCompanyInputSchema,
  UpdateCompanyInputSchema,
  ContactSchema,
  CreateContactInputSchema,
  UpdateContactInputSchema,
  ProductSchema,
  ProductPricingPlanSchema,
  ProductPricingRateSchema,
  ProductPricingResponseSchema,
  ProvisioningDetailSchema,
  ProvisioningFieldSchema,
  ProductDependencySchema,
  OrderSchema,
  OrderLineItemSchema,
  OrderLineItemInputSchema,
  OrderLineItemProvisioningSchema,
  CreateOrderInputSchema,
  CommitmentSchema,
  CommitmentTermSchema,
  SubscriptionSchema,
  UpdateSubscriptionInputSchema,
  SubscriptionHistorySchema,
  InvoiceSchema,
  InvoiceItemSchema,
  UsageSummarySchema,
  UsageLineSchema,
  QuoteSchema,
  QuoteLineItemSchema,
  CreateQuoteInputSchema,
  UpdateQuoteInputSchema,
  WebhookSchema,
  WebhookLogSchema,
  CreateWebhookInputSchema,
  UpdateWebhookInputSchema,
  PageInfoSchema,
  PageSchema,
  PaginatedResponseSchema,
  // Enum schemas (also have inferred types below)
  ContactTypeSchema,
  SubscriptionStatusSchema,
  BillingTermSchema,
  InvoiceStatusSchema,
  WebhookStatusSchema,
  CompanyStatusSchema,
} from "./api/types.js";
export type {
  Address,
  Company,
  CreateCompanyInput,
  UpdateCompanyInput,
  Contact,
  CreateContactInput,
  UpdateContactInput,
  Product,
  ProductPricing,
  ProductPricingPlan,
  ProductPricingRate,
  ProvisioningDetail,
  ProvisioningField,
  ProductDependency,
  Order,
  OrderLineItem,
  OrderLineItemInput,
  CreateOrderInput,
  Commitment,
  CommitmentTerm,
  Subscription,
  UpdateSubscriptionInput,
  SubscriptionHistory,
  Invoice,
  InvoiceItem,
  UsageSummary,
  UsageLine,
  Quote,
  QuoteLineItem,
  CreateQuoteInput,
  UpdateQuoteInput,
  Webhook,
  WebhookLog,
  CreateWebhookInput,
  UpdateWebhookInput,
  PageInfo,
  PaginatedResponse,
  // Enum types
  ContactType,
  SubscriptionStatus,
  BillingTerm,
  InvoiceStatus,
  WebhookStatus,
  CompanyStatus,
} from "./api/types.js";

// ─── Auth ───────────────────────────────────────────────────────────────────

export { TokenManager } from "./auth/token-manager.js";
export { CredentialStore } from "./auth/credential-store.js";
export type { Credentials, PermissionCheckResult } from "./auth/credential-store.js";

// ─── Services: computed business logic over the API ─────────────────────────

export {
  getUpcomingRenewals,
} from "./services/renewal-tracker.js";
export type { RenewalItem, RenewalReport } from "./services/renewal-tracker.js";

export {
  auditInvoices,
} from "./services/invoice-auditor.js";
export type { AuditDiscrepancy, AuditReport } from "./services/invoice-auditor.js";

export {
  subscriptionMrr,
  computeMrr,
  computeGrowth,
} from "./services/analytics.js";
export type { MrrReport, GrowthReport } from "./services/analytics.js";

export {
  executeBulk,
} from "./services/bulk-executor.js";
export type { BulkOp, BulkResult } from "./services/bulk-executor.js";

export {
  getRecommendations,
  getPortfolioCoverage,
  categorizeProduct,
  ALL_CATEGORIES,
} from "./services/recommendations.js";
export type {
  Recommendation,
  RecommendationReport,
  CompanyCoverage,
  ProductCategory,
} from "./services/recommendations.js";

/**
 * On-disk cache for API responses, keyed by request path + params.
 *
 * @internal Used by the bundled `@pax8/cli` for cache invalidation after
 * write operations. Not part of the documented public API — external
 * consumers should rely on the cache being managed transparently by
 * `Pax8Client` and not depend on this class directly.
 */
export { FileCache } from "./services/cache.js";

// ─── Config ─────────────────────────────────────────────────────────────────

export {
  loadConfig,
  saveConfig,
  getConfigDir,
  ensureConfigDir,
} from "./config/loader.js";
export { ConfigSchema } from "./config/schema.js";
export type { Config } from "./config/schema.js";

// ─── Telemetry ──────────────────────────────────────────────────────────────

export {
  Telemetry,
  getTelemetry,
  TELEMETRY_NOTICE,
} from "./telemetry/telemetry.js";
export type { TelemetryEvent } from "./telemetry/telemetry.js";

/**
 * Reset the singleton `Telemetry` instance. Used by the test suite to ensure
 * isolation between tests.
 *
 * @internal
 */
export { resetTelemetry } from "./telemetry/telemetry.js";

// ─── Mock / demo data ───────────────────────────────────────────────────────

export { MockPax8Client } from "./mock/mock-client.js";
export {
  companies as demoCompanies,
  subscriptions as demoSubscriptions,
  products as demoProducts,
  invoices as demoInvoices,
  invoiceItems as demoInvoiceItems,
  orders as demoOrders,
  contacts as demoContacts,
  usageSummaries as demoUsageSummaries,
  usageLines as demoUsageLines,
  quotes as demoQuotes,
  webhooks as demoWebhooks,
  webhookLogs as demoWebhookLogs,
  webhookTopics as demoWebhookTopics,
} from "./mock/demo-data.js";
