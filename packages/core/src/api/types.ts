// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const ContactTypeSchema = z.enum(["Admin", "Billing", "Technical"]);
export type ContactType = z.infer<typeof ContactTypeSchema>;

export const SubscriptionStatusSchema = z.enum([
  "Active",
  "Cancelled",
  "PendingManual",
  "PendingAutomated",
  "PendingCancel",
  "WaitingForDetails",
  "Trial",
  "Converted",
  "PendingActivation",
  "Activated",
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const BillingTermSchema = z.enum([
  "Monthly",
  "Annual",
  "2-Year",
  "3-Year",
  "One-Time",
  "Trial",
  "Activation",
]);
export type BillingTerm = z.infer<typeof BillingTermSchema>;

// Values verified against the `invoices-paged` example in
// `partner-endpoints.json` (devx.pax8.com). The spec's Invoice properties
// block does not declare `status` — believed to be a docs gap on Pax8's
// side; the field is on the wire.
export const InvoiceStatusSchema = z.enum([
  "Unpaid",
  "Paid",
  "Void",
  "Carried",
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const WebhookStatusSchema = z.enum(["Active", "Disabled"]);
export type WebhookStatus = z.infer<typeof WebhookStatusSchema>;

export const CompanyStatusSchema = z.enum(["Active", "Inactive", "Deleted"]);
export type CompanyStatus = z.infer<typeof CompanyStatusSchema>;

// ─── Address ─────────────────────────────────────────────────────────────────

export const AddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
});
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
  /**
   * Partner-side external identifier — typically a PSA / billing-system ID
   * the partner uses to map their own records to a Pax8 company. Surfaced in
   * #273 (fixes #5) so partners using this field to bridge Pax8 ↔ PSA aren't
   * forced to round-trip through the portal. Lookup/filter by `externalId`
   * is intentionally not added here — that's a feature, not a fix.
   */
  externalId: z.string().optional(),
  created: z.string().optional(),
  updatedDate: z.string().optional(),
});
export type Company = z.infer<typeof CompanySchema>;

export const CreateCompanyInputSchema = z.object({
  name: z.string().min(1),
  address: AddressSchema.optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  billOnBehalfOfEnabled: z.boolean().optional(),
  selfServiceAllowed: z.boolean().optional(),
  orderApprovalRequired: z.boolean().optional(),
});
export type CreateCompanyInput = z.infer<typeof CreateCompanyInputSchema>;

export const UpdateCompanyInputSchema = z.object({
  name: z.string().min(1).optional(),
  address: AddressSchema.optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  billOnBehalfOfEnabled: z.boolean().optional(),
  selfServiceAllowed: z.boolean().optional(),
  orderApprovalRequired: z.boolean().optional(),
});
export type UpdateCompanyInput = z.infer<typeof UpdateCompanyInputSchema>;

// ─── Contact ─────────────────────────────────────────────────────────────────

export const ContactSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  companyId: z.string(),
  types: z.array(ContactTypeSchema),
});
export type Contact = z.infer<typeof ContactSchema>;

export const CreateContactInputSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  companyId: z.string(),
  types: z.array(ContactTypeSchema).min(1),
});
export type CreateContactInput = z.infer<typeof CreateContactInputSchema>;

export const UpdateContactInputSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  types: z.array(ContactTypeSchema).optional(),
});
export type UpdateContactInput = z.infer<typeof UpdateContactInputSchema>;

// ─── Product ─────────────────────────────────────────────────────────────────

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  // The public Pax8 API exposes vendor identity as `vendorName`. Earlier CLI
  // versions also carried a duplicate `vendor` field for the same concept;
  // dropped in #273 (fixes #1) so there's a single canonical name.
  vendorName: z.string().optional(),
  sku: z.string().optional(),
  shortDescription: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  unitOfMeasurement: z.string().optional(),
});
export type Product = z.infer<typeof ProductSchema>;

// ─── Product Pricing ─────────────────────────────────────────────────────────

export const ProductPricingRateSchema = z.object({
  partnerBuyRate: z.number(),
  suggestedRetailPrice: z.number(),
  startQuantityRange: z.number().optional(),
  chargeType: z.string().optional(),
});
export type ProductPricingRate = z.infer<typeof ProductPricingRateSchema>;

export const ProductPricingPlanSchema = z.object({
  productId: z.string(),
  productName: z.string().optional(),
  billingTerm: z.string(),
  commitmentTerm: z.string().optional(),
  commitmentTermInMonths: z.number().optional(),
  type: z.string().optional(),
  unitOfMeasurement: z.string().optional(),
  rates: z.array(ProductPricingRateSchema),
});
export type ProductPricingPlan = z.infer<typeof ProductPricingPlanSchema>;

/** Product pricing is returned as a paginated list of pricing plans. */
export const ProductPricingResponseSchema = z.object({
  content: z.array(ProductPricingPlanSchema),
});

/** Convenience alias — an array of pricing plans for a product. */
export type ProductPricing = ProductPricingPlan[];

// ─── Provisioning Detail ─────────────────────────────────────────────────────

export const ProvisioningFieldSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  type: z.string().optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
});
export type ProvisioningField = z.infer<typeof ProvisioningFieldSchema>;

export const ProvisioningDetailSchema = z.object({
  productId: z.string(),
  vendorPrerequisites: z.string().optional(),
  fields: z.array(ProvisioningFieldSchema).optional(),
});
export type ProvisioningDetail = z.infer<typeof ProvisioningDetailSchema>;

// ─── Order ───────────────────────────────────────────────────────────────────

export const OrderLineItemProvisioningSchema = z.record(z.string(), z.unknown());

export const CommitmentTermSchema = z.enum([
  "Monthly",
  "1-Year",
  "3-Year",
]);
export type CommitmentTerm = z.infer<typeof CommitmentTermSchema>;

export const OrderLineItemInputSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().min(1),
  billingTerm: BillingTermSchema.optional(),
  commitmentTermId: z.string().optional(),
  provisioningDetails: OrderLineItemProvisioningSchema.optional(),
});
export type OrderLineItemInput = z.infer<typeof OrderLineItemInputSchema>;

export const OrderLineItemSchema = z.object({
  id: z.string(),
  offerId: z.string().optional(),
  productId: z.string(),
  /** Denormalized product name (demo data convenience). */
  productName: z.string().optional(),
  /** Optional billing term (demo data convenience). */
  billingTerm: BillingTermSchema.optional(),
  lineItemNumber: z.number().int().optional(),
  quantity: z.number(),
  provisioningDetails: OrderLineItemProvisioningSchema.optional(),
});
export type OrderLineItem = z.infer<typeof OrderLineItemSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  /** Denormalized company name. Returned by the demo client; the real API
   * doesn't include it directly but the CLI populates it after lookup. */
  companyName: z.string().optional(),
  orderedBy: z.string().optional(),
  /** Denormalized email of the placing user (demo data convenience). */
  orderedByEmail: z.string().optional(),
  status: z.string().optional(),
  createdDate: z.string(),
  lineItems: z.array(OrderLineItemSchema).optional(),
});
export type Order = z.infer<typeof OrderSchema>;

export const CreateOrderInputSchema = z.object({
  companyId: z.string(),
  lineItems: z.array(OrderLineItemInputSchema).min(1),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;

// ─── Subscription ────────────────────────────────────────────────────────────

export const CommitmentSchema = z.object({
  id: z.string().optional(),
  term: z.string().optional(),
  endDate: z.string().optional(),
});
export type Commitment = z.infer<typeof CommitmentSchema>;

/**
 * Subscription shape returned by `GET /subscriptions{,/{id}}`.
 *
 * Note on commitment-term ergonomics (verified in #273, fixes #2):
 * - The canonical API shape is `commitmentTerm: { id, term, endDate }`. The
 *   CLI preserves that nested object under the alias `commitment` so consumers
 *   who want the full shape (id + term name + endDate) can still get it. The
 *   alias spelling is intentional — every existing demo fixture, mock-client
 *   payload, and `--json` consumer reads it as `commitment`, and renaming back
 *   to `commitmentTerm` would be a breaking surface change with no obvious
 *   payoff.
 * - For ergonomics, the CLI also flattens `commitmentTerm.endDate` to a
 *   top-level `commitmentTermEndDate` so renewal-window math (`subscriptions
 *   renewals`, the `--within` filter, the `Term End` row in `subscriptions
 *   show`, and the upper-bound calculations in `recommendations`) doesn't
 *   have to dig into a nested object on every record. `null` is preserved
 *   distinct from `undefined` because monthly subs return `null` here on the
 *   wire (no commitment term) and we want consumers to be able to tell the
 *   two apart.
 *
 * Both surfaces are intentional — keep the nested object **and** the
 * flattened endDate. A future canonical-rename pass (alias → `commitmentTerm`,
 * dropping the flattened field, or vice versa) would be a breaking change
 * tracked separately.
 */
export const SubscriptionSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  productId: z.string(),
  quantity: z.number(),
  startDate: z.string(),
  endDate: z.string().optional(),
  createdDate: z.string(),
  billingStart: z.string().optional(),
  status: SubscriptionStatusSchema,
  price: z.number().optional(),
  /**
   * ISO-4217 currency code (e.g. `USD`, `EUR`). Optional defensively:
   * pre-#273 demo fixtures didn't carry it. Surfaced in #273 (fixes #6) so
   * non-USD partners aren't silently treated as USD. The CLI table view only
   * appends the code next to the price when it isn't `USD`, to avoid
   * cluttering the common case.
   */
  currencyCode: z.string().optional(),
  billingTerm: BillingTermSchema.optional(),
  commitment: CommitmentSchema.optional(),
  commitmentTermEndDate: z.string().nullable().optional(),
  companyName: z.string().optional(),
  productName: z.string().optional(),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

export const UpdateSubscriptionInputSchema = z.object({
  quantity: z.number().int().min(1).optional(),
  billingTerm: BillingTermSchema.optional(),
});
export type UpdateSubscriptionInput = z.infer<typeof UpdateSubscriptionInputSchema>;

// ─── Subscription History ────────────────────────────────────────────────────

export const SubscriptionHistorySchema = z.object({
  id: z.string(),
  action: z.string(),
  date: z.string(),
  quantity: z.number(),
  previousQuantity: z.number().optional(),
});
export type SubscriptionHistory = z.infer<typeof SubscriptionHistorySchema>;

// ─── Invoice ─────────────────────────────────────────────────────────────────

export const InvoiceSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  invoiceDate: z.string(),
  dueDate: z.string(),
  // Optional defensively: the public OpenAPI Invoice properties block does
  // not declare `status`, even though the field appears in the spec's
  // example response. Until the spec is fixed, partners reading the schema
  // could legitimately produce payloads without this field.
  status: InvoiceStatusSchema.optional(),
  total: z.number(),
  balance: z.number(),
  companyName: z.string().optional(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

// ─── Invoice Item ────────────────────────────────────────────────────────────

export const InvoiceItemSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  productId: z.string(),
  subscriptionId: z.string().optional(),
  quantity: z.number(),
  // Field names mirror the public Pax8 API: `price` (per-unit) and `subTotal`
  // (line subtotal). Earlier CLI versions exposed these as `unitPrice` and
  // `subtotal`; renamed in #273 (fixes #4) to align `--json` output with the
  // upstream contract so partners reading both surfaces don't have to translate.
  price: z.number(),
  subTotal: z.number(),
  companyId: z.string().optional(),
  productName: z.string().optional(),
  companyName: z.string().optional(),
});
export type InvoiceItem = z.infer<typeof InvoiceItemSchema>;

// ─── Usage Summary ───────────────────────────────────────────────────────────

export const UsageSummarySchema = z.object({
  id: z.string(),
  companyId: z.string(),
  productId: z.string(),
  /**
   * Subscription the usage rolls up to. Optional because not every backend
   * response includes it (the field is denormalized client-side from the
   * `/subscriptions/{id}/usage-summaries` request context), but populated in
   * demo data so commands can resolve summary → subscription without a
   * second lookup.
   */
  subscriptionId: z.string().optional(),
  date: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  subtotal: z.number(),
  resourceGroup: z.string().optional(),
  companyName: z.string().optional(),
  productName: z.string().optional(),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

// ─── Usage Line ──────────────────────────────────────────────────────────────

export const UsageLineSchema = z.object({
  id: z.string(),
  usageSummaryId: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  subtotal: z.number(),
  description: z.string().nullable().optional(),
  date: z.string(),
});
export type UsageLine = z.infer<typeof UsageLineSchema>;

// ─── Quote ───────────────────────────────────────────────────────────────────

export const QuoteLineItemSchema = z.object({
  /**
   * Line item identifier. Optional because the v1 quote surface didn't expose
   * it on every line; the v2 endpoints (`POST /v2/quotes/{id}/line-items`,
   * `DELETE .../line-items/{lineItemId}`) require it for per-line operations.
   * Demo data populates it.
   */
  id: z.string().optional(),
  productId: z.string(),
  quantity: z.number(),
  billingTerm: BillingTermSchema.optional(),
  unitPrice: z.number().optional(),
  subtotal: z.number().optional(),
});
export type QuoteLineItem = z.infer<typeof QuoteLineItemSchema>;

/**
 * Mirror of the public quoting API's `RespondedBy` shape — the partner-side
 * actor who accepted or declined the quote. All fields optional because the
 * API populates them conditionally depending on the response channel.
 */
export const QuoteRespondedBySchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  respondedOn: z.string().optional(),
});
export type QuoteRespondedBy = z.infer<typeof QuoteRespondedBySchema>;

/**
 * Quote response body. The public quoting v2 endpoint returns the workflow
 * fields (`acceptedBy`, `declinedBy`, `respondedOn`, `revokedOn`,
 * `publishedOn`, `published`, `referenceCode`, `salesMarginPercentage`,
 * `intentType`) only after the relevant transition has occurred — they're
 * all optional here so reads of draft/sent quotes parse cleanly.
 *
 * Status is left permissive (`z.string()`) because the API enum is lowercase
 * (`draft`, `sent`, `accepted`, `declined`, `expired`, `closed`,
 * `changes_requested`, `pending`, `assigned`) but legacy demo data and the
 * test suite use the historical titlecase form. Forward-compat with new
 * statuses is also a goal.
 */
export const QuoteSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  // Field names mirror the public quoting v2 API: `createdOn` and `expiresOn`.
  // Earlier CLI versions exposed these as `createdDate` and `expirationDate`;
  // renamed in #273 (fixes #8) to align `--json` output with the upstream
  // contract. The `--expiration-date` CLI flag is unchanged — flag vocabulary
  // and field vocabulary are intentionally separate concerns.
  createdOn: z.string(),
  expiresOn: z.string().optional(),
  status: z.string(),
  lineItems: z.array(QuoteLineItemSchema).optional(),

  // Workflow fields (read-only visibility for the accept/decline lifecycle).
  acceptedBy: QuoteRespondedBySchema.optional(),
  declinedBy: QuoteRespondedBySchema.optional(),
  respondedOn: z.string().optional(),
  revokedOn: z.string().optional(),
  publishedOn: z.string().optional(),
  published: z.boolean().optional(),
  referenceCode: z.string().optional(),
  salesMarginPercentage: z.number().optional(),
  intentType: z.string().optional(),
});
export type Quote = z.infer<typeof QuoteSchema>;

// ─── Webhook ─────────────────────────────────────────────────────────────────

export const WebhookSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  topics: z.array(z.string()),
  status: WebhookStatusSchema,
  createdDate: z.string(),
  /**
   * HMAC signing secret. Tier 0 (Existential) per Pax8 Data Risk Tiering.
   * Returned by the API only on POST create (and possibly on rotation);
   * the CLI redacts/omits this field on read paths (show / list / logs).
   * Partners who need the secret should save it on creation; if lost,
   * rotate via the webhook update flow.
   *
   * Optional in the schema because the API may include or omit it; the
   * CLI's read-path commands strip it defensively before any output
   * (#300). See issue #241 for the original create-time-only contract.
   */
  secret: z.string().optional(),
  /** Human-friendly label for the webhook (Pax8 v2.1+). */
  displayName: z.string().optional(),
  /** Email Pax8 notifies when delivery failures exceed `errorThreshold`. */
  contactEmail: z.string().optional(),
  /** Consecutive failures before Pax8 notifies `contactEmail`. Server cap is 20. */
  errorThreshold: z.number().int().optional(),
  /** Last delivery outcome reported by Pax8 (PENDING | SUCCESS | FAILED | RETRYING). */
  lastDeliveryStatus: z.string().optional(),
  /** ISO timestamp of last update (Pax8 v2.1+). */
  updatedAt: z.string().optional(),
});
export type Webhook = z.infer<typeof WebhookSchema>;

/**
 * One entry in the `webhookTopics` array on `POST /webhooks` (Pax8 webhooks
 * API v2 `AddWebhookTopic` schema). The wire shape is structured —
 * `{ topic, filters }` — not a bare string. `filters` is required on the
 * server side, but the CLI doesn't expose per-topic filter expressions yet,
 * so the default-empty `[]` is sent. The `filters` element type is left
 * loose (`z.unknown()`) on purpose: the spec accepts `UpdateWebhookFilter`
 * objects ({ action, conditions: [{ field, operator, value }] }) but the
 * CLI surface for authoring them is a separate feature and the schema
 * shouldn't reject filters the user assembles by hand against the spec.
 */
export const AddWebhookTopicSchema = z.object({
  topic: z.string().min(1),
  filters: z.array(z.unknown()).default([]),
});
export type AddWebhookTopic = z.infer<typeof AddWebhookTopicSchema>;

/**
 * Request body for `POST /webhooks` (Pax8 webhooks API v2 `CreateWebhook`
 * schema). `displayName` is required by the spec — a spec-strict server
 * 422s without it. `webhookTopics` is the structured replacement for the
 * pre-#323 `topics: string[]` shape; each entry carries a `topic` slug and
 * an optional filter array.
 *
 * Only the two fields the spec marks required plus the topic subscription
 * list are modeled here. `authorization`, `active`, `contactEmail`,
 * `errorThreshold`, and `integrationId` are accepted by the spec on create
 * but are intentionally not exposed by the CLI yet — they're tracked as
 * separate flag-surface enhancements in #323's "out of scope" section.
 */
export const CreateWebhookInputSchema = z.object({
  displayName: z.string().min(1),
  url: z.string().url(),
  webhookTopics: z.array(AddWebhookTopicSchema).min(1),
});
export type CreateWebhookInput = z.infer<typeof CreateWebhookInputSchema>;

/**
 * Mutable configuration fields for `POST /webhooks/{id}/configuration`.
 * Mirrors the `UpdateWebhookConfiguration` shape in webhook-manager v2/v2.1.
 * `authorization` is a sensitive header value — treat it as a secret in any
 * non-`--json` output.
 */
export const UpdateWebhookConfigurationInputSchema = z.object({
  displayName: z.string().min(1).optional(),
  url: z.string().url().optional(),
  authorization: z.string().optional(),
  contactEmail: z.string().email().optional(),
  errorThreshold: z.number().int().min(1).max(20).optional(),
});
export type UpdateWebhookConfigurationInput = z.infer<typeof UpdateWebhookConfigurationInputSchema>;

// ─── Webhook Log ─────────────────────────────────────────────────────────────

export const WebhookLogSchema = z.object({
  id: z.string(),
  webhookId: z.string(),
  topic: z.string(),
  responseCode: z.number(),
  responseBody: z.string().optional(),
  sentAt: z.string(),
});
export type WebhookLog = z.infer<typeof WebhookLogSchema>;

// ─── Webhook Topic Definition ────────────────────────────────────────────────

/**
 * Discoverable topic exposed by `GET /webhooks/topic-definitions`.
 *
 * Per the public webhooks OpenAPI spec, every topic carries a `topic` slug
 * (the value passed to `--topics` on create) plus a human `name` and
 * `description`. The optional `availableFilters` and `samplePayload` fields
 * are also defined by the upstream `TopicDefinition` schema; they're parsed
 * loosely (`z.unknown()`) because the CLI surface only needs `topic` and
 * `description` today and we'd rather not ship a full payload schema we
 * don't validate against.
 */
export const TopicDefinitionSchema = z.object({
  topic: z.string(),
  name: z.string(),
  description: z.string(),
  availableFilters: z.array(z.unknown()).optional(),
  samplePayload: z.unknown().optional(),
});
export type TopicDefinition = z.infer<typeof TopicDefinitionSchema>;

// ─── Paginated Response ──────────────────────────────────────────────────────

export const PageInfoSchema = z.object({
  size: z.number(),
  totalElements: z.number(),
  totalPages: z.number(),
  number: z.number(),
});
export type PageInfo = z.infer<typeof PageInfoSchema>;

export function PaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    page: PageInfoSchema,
    content: z.array(itemSchema),
  });
}

export type PaginatedResponse<T> = {
  page: PageInfo;
  content: T[];
};

// ─── Quote Input Types ──────────────────────────────────────────────────────

export const CreateQuoteInputSchema = z.object({
  companyId: z.string(),
  lineItems: z.array(z.object({
    productId: z.string(),
    quantity: z.number().int().positive(),
    billingTerm: BillingTermSchema.optional(),
    provisioningDetails: z.record(z.string(), z.unknown()).optional(),
  })),
});
export type CreateQuoteInput = z.infer<typeof CreateQuoteInputSchema>;

export const UpdateQuoteInputSchema = z.object({
  lineItems: z.array(z.object({
    productId: z.string(),
    quantity: z.number().int().positive(),
    billingTerm: BillingTermSchema.optional(),
    provisioningDetails: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
  expiresOn: z.string().optional(),
});
export type UpdateQuoteInput = z.infer<typeof UpdateQuoteInputSchema>;

/**
 * Input for `POST /v2/quotes/{quoteId}/line-items` — append a single standard
 * line item. The upstream API accepts an array of mixed-type payloads
 * (Standard / Custom / UsageBased); we expose the common Standard shape here
 * because that's what `quotes line-items add` constructs from `--product`,
 * `--quantity`, `--billing-term`, `--price`, and `--effective-date`.
 *
 * `effectiveDate` and `price` are required by the v2 `AddStandardLineItemPayload`
 * schema (see #312, `docs/triage/quotes-api-version.md` §9.1). `effectiveDate`
 * is an ISO 8601 date-time string (e.g. `2026-05-11T00:00:00Z`); `price` is the
 * per-unit price the partner is quoting to the customer (defaults to the
 * product's list price / `suggestedRetailPrice` for the chosen `billingTerm`
 * when the CLI resolves it).
 */
export const AddQuoteLineItemInputSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
  billingTerm: BillingTermSchema.optional(),
  effectiveDate: z.string(),
  price: z.number(),
});
export type AddQuoteLineItemInput = z.infer<typeof AddQuoteLineItemInputSchema>;

/**
 * Body for `PUT /v2/quotes/{quoteId}` when transitioning a quote to `sent`.
 * Other transitions (`accepted`, `declined`, etc.) ride a different code path.
 */
export const QuoteStatusTransitionSchema = z.enum([
  "draft",
  "assigned",
  "sent",
  "closed",
  "declined",
  "accepted",
  "changes_requested",
  "expired",
  "pending",
]);
export type QuoteStatusTransition = z.infer<typeof QuoteStatusTransitionSchema>;

// Aliases for backward compatibility
export const PageSchema = PageInfoSchema;

// ─── Product Dependency ─────────────────────────────────────────────────────

export const ProductDependencySchema = z.object({
  id: z.string(),
  productId: z.string(),
  dependsOnProductId: z.string(),
  dependencyType: z.string(),
  description: z.string().nullable().optional(),
});
export type ProductDependency = z.infer<typeof ProductDependencySchema>;
