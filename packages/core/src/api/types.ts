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
  minQuantity: z.number(),
  maxQuantity: z.number().optional(),
  unitPrice: z.number(),
  flatPrice: z.number().optional(),
  partnerBuyPrice: z.number().optional(),
});
export type ProductPricingRate = z.infer<typeof ProductPricingRateSchema>;

export const ProductPricingSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  rates: z.array(ProductPricingRateSchema),
});
export type ProductPricing = z.infer<typeof ProductPricingSchema>;

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

export const OrderLineItemInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1),
  billingTerm: BillingTermSchema.optional(),
  provisioningDetails: OrderLineItemProvisioningSchema.optional(),
});
export type OrderLineItemInput = z.infer<typeof OrderLineItemInputSchema>;

export const OrderLineItemSchema = z.object({
  id: z.string().uuid(),
  offerId: z.string().optional(),
  productId: z.string().uuid(),
  lineItemNumber: z.number().int().optional(),
  quantity: z.number(),
  provisioningDetails: OrderLineItemProvisioningSchema.optional(),
});
export type OrderLineItem = z.infer<typeof OrderLineItemSchema>;

export const OrderSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  orderedBy: z.string().optional(),
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
  commitmentTermEndDate: z.string().optional(),
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
