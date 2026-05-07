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
  "Inactive",
  "Deleted",
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

export const InvoiceStatusSchema = z.enum([
  "Unpaid",
  "Paid",
  "Void",
  "Carry",
  "Nothing",
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
  id: z.string().uuid(),
  name: z.string(),
  address: AddressSchema.optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  status: CompanyStatusSchema.optional(),
  billOnBehalfOfEnabled: z.boolean().optional(),
  selfServiceAllowed: z.boolean().optional(),
  orderApprovalRequired: z.boolean().optional(),
  created: z.string().optional(),
  modified: z.string().optional(),
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
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  companyId: z.string().uuid(),
  types: z.array(ContactTypeSchema),
});
export type Contact = z.infer<typeof ContactSchema>;

export const CreateContactInputSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  companyId: z.string().uuid(),
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
  id: z.string().uuid(),
  name: z.string(),
  vendorName: z.string().optional(),
  vendor: z.string().optional(),
  sku: z.string().optional(),
  shortDescription: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  unitOfMeasurement: z.string().optional(),
  categoryName: z.string().optional(),
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
  productId: z.string().uuid(),
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
  productId: z.string().uuid(),
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
  productId: z.string().uuid(),
  quantity: z.number().int().min(1),
  billingTerm: BillingTermSchema.optional(),
  commitmentTermId: z.string().uuid().optional(),
  provisioningDetails: OrderLineItemProvisioningSchema.optional(),
});
export type OrderLineItemInput = z.infer<typeof OrderLineItemInputSchema>;

export const OrderLineItemSchema = z.object({
  id: z.string().uuid(),
  offerId: z.string().optional(),
  productId: z.string().uuid(),
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
  id: z.string().uuid(),
  companyId: z.string().uuid(),
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
  companyId: z.string().uuid(),
  lineItems: z.array(OrderLineItemInputSchema).min(1),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;

// ─── Subscription ────────────────────────────────────────────────────────────

export const CommitmentSchema = z.object({
  id: z.string().uuid().optional(),
  term: z.string().optional(),
  endDate: z.string().optional(),
});
export type Commitment = z.infer<typeof CommitmentSchema>;

export const SubscriptionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number(),
  startDate: z.string(),
  endDate: z.string().optional(),
  createdDate: z.string(),
  billingStart: z.string().optional(),
  status: SubscriptionStatusSchema,
  price: z.number().optional(),
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
  id: z.string().uuid(),
  action: z.string(),
  date: z.string(),
  quantity: z.number(),
  previousQuantity: z.number().optional(),
});
export type SubscriptionHistory = z.infer<typeof SubscriptionHistorySchema>;

// ─── Invoice ─────────────────────────────────────────────────────────────────

export const InvoiceSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  invoiceDate: z.string(),
  dueDate: z.string(),
  status: InvoiceStatusSchema,
  total: z.number(),
  balance: z.number(),
  companyName: z.string().optional(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

// ─── Invoice Item ────────────────────────────────────────────────────────────

export const InvoiceItemSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  productId: z.string().uuid(),
  subscriptionId: z.string().uuid().optional(),
  quantity: z.number(),
  unitPrice: z.number(),
  subtotal: z.number(),
  companyId: z.string().uuid().optional(),
  productName: z.string().optional(),
  companyName: z.string().optional(),
});
export type InvoiceItem = z.infer<typeof InvoiceItemSchema>;

// ─── Usage Summary ───────────────────────────────────────────────────────────

export const UsageSummarySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  productId: z.string().uuid(),
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
  id: z.string().uuid(),
  usageSummaryId: z.string().uuid(),
  quantity: z.number(),
  unitPrice: z.number(),
  subtotal: z.number(),
  description: z.string().nullable().optional(),
  date: z.string(),
});
export type UsageLine = z.infer<typeof UsageLineSchema>;

// ─── Quote ───────────────────────────────────────────────────────────────────

export const QuoteLineItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number(),
  billingTerm: BillingTermSchema.optional(),
  unitPrice: z.number().optional(),
  subtotal: z.number().optional(),
});
export type QuoteLineItem = z.infer<typeof QuoteLineItemSchema>;

export const QuoteSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  createdDate: z.string(),
  expirationDate: z.string().optional(),
  status: z.string(),
  lineItems: z.array(QuoteLineItemSchema).optional(),
});
export type Quote = z.infer<typeof QuoteSchema>;

// ─── Webhook ─────────────────────────────────────────────────────────────────

export const WebhookSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  topics: z.array(z.string()),
  status: WebhookStatusSchema,
  createdDate: z.string(),
  secret: z.string().optional(),
});
export type Webhook = z.infer<typeof WebhookSchema>;

export const CreateWebhookInputSchema = z.object({
  url: z.string().url(),
  topics: z.array(z.string()).min(1),
});
export type CreateWebhookInput = z.infer<typeof CreateWebhookInputSchema>;

export const UpdateWebhookInputSchema = z.object({
  url: z.string().url().optional(),
  topics: z.array(z.string()).optional(),
  status: WebhookStatusSchema.optional(),
});
export type UpdateWebhookInput = z.infer<typeof UpdateWebhookInputSchema>;

// ─── Webhook Log ─────────────────────────────────────────────────────────────

export const WebhookLogSchema = z.object({
  id: z.string().uuid(),
  webhookId: z.string().uuid(),
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
 * (the value passed to `--events` on create) plus a human `name` and
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
  companyId: z.string().uuid(),
  lineItems: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
    billingTerm: BillingTermSchema.optional(),
    provisioningDetails: z.record(z.string(), z.unknown()).optional(),
  })),
});
export type CreateQuoteInput = z.infer<typeof CreateQuoteInputSchema>;

export const UpdateQuoteInputSchema = z.object({
  lineItems: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
    billingTerm: BillingTermSchema.optional(),
    provisioningDetails: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
  expirationDate: z.string().optional(),
});
export type UpdateQuoteInput = z.infer<typeof UpdateQuoteInputSchema>;

// Aliases for backward compatibility
export const PageSchema = PageInfoSchema;

// ─── Product Dependency ─────────────────────────────────────────────────────

export const ProductDependencySchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  dependsOnProductId: z.string().uuid(),
  dependencyType: z.string(),
  description: z.string().nullable().optional(),
});
export type ProductDependency = z.infer<typeof ProductDependencySchema>;
