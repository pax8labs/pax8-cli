// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

// ─── Enums ───────────────────────────────────────────────────────────────────

/**
 * Underlying enum value for the kind of contact role. The Pax8 public OpenAPI
 * spec defines this as the `type` property on a `ContactType` object (the wire
 * shape — see `ContactTypeSchema` below). Exposed separately so CLI flag
 * vocabulary (`--type Admin,Billing,Technical`) can keep validating against
 * the bare enum even though the wire body carries `{type, primary}` objects.
 *
 * Reshape landed in #325 alongside the body-shape fix; pre-#325 this whole
 * concept was a flat enum.
 */
export const ContactTypeKindSchema = z.enum(["Admin", "Billing", "Technical"]);
export type ContactTypeKind = z.infer<typeof ContactTypeKindSchema>;

/**
 * Wire shape for one entry in a Contact's `types` array, per
 * `components.schemas.ContactType` in the Pax8 public OpenAPI spec:
 * `{ type: "Admin"|"Billing"|"Technical", primary: boolean }`.
 *
 * Pre-#325 the CLI sent `types: string[]` (the kind enum directly), which a
 * spec-strict server would 422. The CLI flag surface still accepts comma-
 * separated kind names (`--type Admin,Billing`) and inflates each entry to
 * `{type, primary: false}` at handler time; per-type `primary` UX is tracked
 * separately and intentionally out of scope here.
 */
export const ContactTypeSchema = z.object({
  type: ContactTypeKindSchema,
  primary: z.boolean().default(false),
});
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

/**
 * Address shape on the wire. Field names mirror the public Pax8 OpenAPI
 * `Address` schema (`partner-endpoints.json` → `components.schemas.Address`):
 * `stateOrProvince` and `postalCode`, NOT `state` / `zip`.
 *
 * Pre-#327/#328 the CLI used `state` and `zip` here, which silently
 * (a) dropped state/postal data on `companies create` (the API didn't
 * recognize the leaf names) and (b) dropped the corresponding fields on
 * every read (Zod's default non-strict mode strips unknown keys). The
 * read- and write-side share this schema, so renaming here fixes both.
 *
 * The user-facing CLI flag names (`--state`, `--zip`) are deliberately
 * unchanged — flag vocabulary and wire vocabulary are intentionally
 * separate (see `docs/UX_GUIDE.md`, `docs/domain-review.md` §Companies).
 * The mapping happens at body-construction time in
 * `packages/cli/src/commands/companies/{create,update}.ts`.
 */
export const AddressSchema = z.object({
  street: z.string().optional(),
  street2: z.string().optional(),
  city: z.string().optional(),
  stateOrProvince: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
});
export type Address = z.infer<typeof AddressSchema>;

// ─── Company ─────────────────────────────────────────────────────────────────

/**
 * `companyId` mirrors the public API's current field name. Pax8 is
 * structurally moving away from the COMPANY noun in API contracts (per
 * the Client Archetype governance review). The user-facing canonical
 * term is `client`; the underlying API field name may eventually become
 * `accountId` rather than `clientId`, per Pax8's account-archetype
 * model. The CLI command surface uses `clients` today (per #317); the
 * data surface stays aligned with whatever the wire actually carries.
 */
/**
 * Wire shape for `GET /companies{,/{id}}`. Reads accept both the legacy
 * Pax8-API field names (`created`, `updatedDate`) and the canonical
 * camelCase / past-tense names (`createdAt`, `updatedAt`). The Zod
 * preprocess maps the legacy wire names onto the canonical fields so the
 * parsed object always carries the canonical names. See #385.
 */
export const CompanySchema = z.preprocess(
  (raw) => {
    if (raw === null || typeof raw !== "object") return raw;
    const r = raw as Record<string, unknown>;
    const createdAt =
      typeof r.createdAt === "string"
        ? r.createdAt
        : typeof r.created === "string"
          ? r.created
          : undefined;
    const updatedAt =
      typeof r.updatedAt === "string"
        ? r.updatedAt
        : typeof r.updatedDate === "string"
          ? r.updatedDate
          : undefined;
    return {
      ...r,
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    };
  },
  z.object({
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
    /**
     * Canonical timestamp the company was created (camelCase, past tense,
     * ISO 8601 string). Always present on read if the wire payload carried
     * either `createdAt` or the legacy `created`.
     */
    createdAt: z.string().optional(),
    /**
     * Canonical timestamp the company was last updated. Optional because
     * the wire may omit it.
     */
    updatedAt: z.string().optional(),
  }),
);
export type Company = z.infer<typeof CompanySchema>;

/**
 * Inline contact shape for `POST /companies` atomic create. Mirrors the spec
 * body for the contacts-array element: same four scalars as the standalone
 * contact body (`firstName`, `lastName`, `email`, `phone`) plus the `types`
 * array of `{type, primary}` objects (`ContactTypeSchema`). Before the
 * atomic-create endpoint shipped, the create endpoint took company-only
 * fields and partners had to follow up with `POST /companies/{id}/contacts`
 * for each primary contact, leaving a window where the company was Inactive.
 *
 * Distinct from `CreateContactInputSchema` only because the atomic-create
 * variant cannot carry `companyId` (the company doesn't exist yet) — every
 * other field matches. We re-derive rather than `.omit()` because the spec
 * gives this nested shape its own schema name.
 */
export const CreateCompanyContactInputSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  types: z.array(ContactTypeSchema).min(1),
});
export type CreateCompanyContactInput = z.infer<typeof CreateCompanyContactInputSchema>;

/**
 * Body for `POST /companies`. The public OpenAPI marks
 * `["name", "address", "phone", "website", "billOnBehalfOfEnabled",
 *   "selfServiceAllowed", "orderApprovalRequired"]` as required (see
 * `partner-endpoints.json` → `components.schemas.Company.required`). The
 * three boolean flags previously slipped through as `.optional()`, leaving
 * required-field-violating requests on the wire — fixed in #329.
 *
 * `address` is intentionally `.optional()` at the type level so callers that
 * omit it don't produce a degenerate empty `{ street: "", city: "", ... }`
 * object on the wire. The CLI's `companies create` handler fail-fasts with
 * `ERROR_INVALID_INPUT` when no address flag is supplied (matches the spec's
 * `address` requirement at the UX layer).
 *
 * `contacts` is the atomic-create payload for the Pax8 companies API.
 * Including a properly-typed primary contact (`primary: true` on
 * all three `ContactType` values — Admin, Billing, Technical) flips the new
 * company from Inactive to Active at creation. Per the Pax8 API Reference:
 * "A Company is required to have a primary Contact for each Contact Type
 * ('Admin', 'Billing', 'Technical'). One contact with all three types and
 * marked as primary for each type is sufficient." The CLI handler implicitly
 * constructs the three-types-primary contact from `--first-name`,
 * `--last-name`, `--email`, `--phone`. Omitting `contacts` entirely (the
 * `--company-only` path) produces an Inactive company; the handler prints a
 * loud warning before that path. Closes #330.
 */
export const CreateCompanyInputSchema = z.object({
  name: z.string().min(1),
  address: AddressSchema.optional(),
  phone: z.string(),
  website: z.string(),
  billOnBehalfOfEnabled: z.boolean(),
  selfServiceAllowed: z.boolean(),
  orderApprovalRequired: z.boolean(),
  contacts: z.array(CreateCompanyContactInputSchema).optional(),
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
  // `companyId` is set client-side from the URL path (the spec's nested
  // resource carries it there, not in the body) but every consumer in the
  // codebase still expects to read it back. The mock client populates it and
  // demo fixtures carry it; on real-API parses, the field is filled by the
  // handler that knows the company context.
  companyId: z.string(),
  types: z.array(ContactTypeSchema),
});
export type Contact = z.infer<typeof ContactSchema>;

/**
 * Body for `POST /v1/companies/{companyId}/contacts` per the public OpenAPI
 * spec's `Contact` request schema. The four scalars are required by the spec;
 * `companyId` is intentionally absent — it's already on the URL path. Pre-#325
 * the body carried `companyId` (a body field the spec does not declare) and
 * left `phone` optional (the spec marks it required).
 */
export const CreateContactInputSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  types: z.array(ContactTypeSchema).min(1),
});
export type CreateContactInput = z.infer<typeof CreateContactInputSchema>;

/**
 * Body for `PUT /v1/companies/{companyId}/contacts/{contactId}`. The spec
 * uses **PUT, not PATCH**, and the same `Contact` request schema as create —
 * so a spec-strict server expects a full replacement document with the four
 * required scalars (`firstName`, `lastName`, `email`, `phone`). The CLI
 * handler enforces partial UX by fetch-then-merging the current contact
 * before constructing this body (#325). `types` is optional here because the
 * handler also merges that field — but if present, it must be the spec-
 * shaped array of `{type, primary}` objects.
 */
export const UpdateContactInputSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
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

/**
 * Per the public Pax8 OpenAPI spec's `ProvisioningDetail` component, the same
 * schema is used on three surfaces with read/write field directionality:
 *
 *   - GET /products/{productId}/provision-details — discovery (read)
 *   - POST /orders (CreateLineItem.provisioningDetails) — write
 *   - PUT /subscriptions/{subscriptionId}.provisioningDetails — write
 *
 * `key` is the field key (e.g. `userEmailAddress`). `values` is writeOnly —
 * partner-supplied values. The rest are readOnly metadata returned by the
 * discovery endpoint: `label`, `description`, `valueType`
 * (`Input` | `Single-Value` | `Multi-Value`), and `possibleValues` (the allowed
 * set when `valueType` is `Single-Value` or `Multi-Value`, null when `Input`).
 *
 * Prior to this fix the schema hallucinated a `{ productId, vendorPrerequisites,
 * fields: [{ name, label, type, required, options }] }` shape — none of which
 * exists in the spec.
 */
export const ProvisioningDetailValueTypeSchema = z.enum([
  "Input",
  "Single-Value",
  "Multi-Value",
]);
export type ProvisioningDetailValueType = z.infer<typeof ProvisioningDetailValueTypeSchema>;

export const ProvisioningDetailSchema = z.object({
  key: z.string().optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  valueType: ProvisioningDetailValueTypeSchema.optional(),
  possibleValues: z.array(z.string()).nullable().optional(),
  values: z.array(z.string()).optional(),
});
export type ProvisioningDetail = z.infer<typeof ProvisioningDetailSchema>;

/**
 * Wire envelope for `GET /products/{productId}/provision-details`. Per the
 * spec the response is wrapped in `{ content: ProvisioningDetail[] }` (no
 * `page` block on this endpoint — it's not paginated).
 */
export const ProvisioningDetailResponseSchema = z.object({
  content: z.array(ProvisioningDetailSchema),
});
export type ProvisioningDetailResponse = z.infer<typeof ProvisioningDetailResponseSchema>;

// ─── Line-item provisioning (shared by Orders + Quotes) ─────────────────────

/**
 * Per-line provisioning detail, matching the public Pax8 OpenAPI spec's
 * `ProvisioningDetail` schema (partner-endpoints.json + quoting-endpoints.json
 * both share this shape):
 *
 *   { key: string, values: string[] }
 *
 * Prior to #332 this was typed as `Record<string, unknown>` — an object map —
 * which is **not** what the API accepts on `POST /orders`
 * (`CreateLineItem.provisioningDetails` is an array). No CLI surface populated
 * the field at the time of the fix, so no traffic was breaking; the bad shape
 * was just baked into the input contract waiting for the first caller to
 * trip on it. Renamed from `ProvisioningDetailSchema` so it doesn't collide
 * with the products-side `ProvisioningDetailSchema` (which describes a
 * *product's* provisioning requirements, not an order-line's provisioning
 * values — same word, different concept).
 *
 * Initially introduced as `OrderLineItemProvisioningDetailSchema` in #332;
 * renamed to drop the `Order` prefix in #356 because the quotes line-item
 * path (`POST /v2/quotes/{id}/line-items`) carries the same `ProvisioningDetail`
 * shape per the public quoting OpenAPI spec
 * (`AddStandardLineItemPayload.provisioningDetails`). The old export names
 * remain as aliases at the bottom of this section for embedders that imported
 * them under the original symbol.
 */
export const LineItemProvisioningDetailSchema = z.object({
  key: z.string(),
  values: z.array(z.string()),
});
export type LineItemProvisioningDetail = z.infer<typeof LineItemProvisioningDetailSchema>;

/**
 * Wire shape for a line item's `provisioningDetails` — an array of
 * `{ key, values[] }` objects per the spec. Used by both orders
 * (`OrderLineItem` / `OrderLineItemInput`) and quotes (the v2
 * `AddStandardLineItemPayload`). See #332 (orders) and #356 (rename + quotes
 * surface).
 */
export const LineItemProvisioningSchema = z.array(
  LineItemProvisioningDetailSchema,
);

/**
 * Backward-compatibility aliases for the pre-#356 names. Embedders that
 * imported `OrderLineItemProvisioningDetailSchema` /
 * `OrderLineItemProvisioningSchema` / `OrderLineItemProvisioningDetail` from
 * `@pax8/core` continue to work unchanged. Prefer the domain-neutral names
 * (`LineItemProvisioning*`) in new code — the schemas are shared by orders
 * and quotes.
 */
export const OrderLineItemProvisioningDetailSchema = LineItemProvisioningDetailSchema;
export const OrderLineItemProvisioningSchema = LineItemProvisioningSchema;
export type OrderLineItemProvisioningDetail = LineItemProvisioningDetail;

export const CommitmentTermSchema = z.enum([
  "Monthly",
  "1-Year",
  "3-Year",
]);
export type CommitmentTerm = z.infer<typeof CommitmentTermSchema>;

/**
 * Outgoing `POST /orders` line-item shape. `lineItemNumber` is marked required
 * by the public Pax8 OpenAPI spec (`CreateLineItem.required = ["productId",
 * "companyId", "lineItemNumber", "quantity", "billingTerm"]`); it's a 1-based
 * reference number used by `parentLineItemNumber` to express child line items
 * within the same order. The CLI doesn't expose it as user-facing input —
 * `OrdersApi.create()` auto-injects sequential numbers (1, 2, 3, ...) from the
 * array index so callers don't have to think about it. See #331.
 */
export const OrderLineItemInputSchema = z.object({
  productId: z.string(),
  lineItemNumber: z.number().int().min(1),
  quantity: z.number().int().min(1),
  billingTerm: BillingTermSchema.optional(),
  commitmentTermId: z.string().optional(),
  provisioningDetails: LineItemProvisioningSchema.optional(),
});
export type OrderLineItemInput = z.infer<typeof OrderLineItemInputSchema>;

/**
 * Caller-facing line-item shape — same as the wire shape but with
 * `lineItemNumber` optional. `OrdersApi.create()` accepts this and auto-fills
 * `lineItemNumber = idx + 1` for any line that doesn't provide one. Use this
 * type at the CLI and embedded-consumer boundary; the wire-shape (strict)
 * `OrderLineItemInput` is what gets serialized.
 */
export const OrderLineItemCreateInputSchema = OrderLineItemInputSchema.extend({
  lineItemNumber: z.number().int().min(1).optional(),
});
export type OrderLineItemCreateInput = z.infer<typeof OrderLineItemCreateInputSchema>;

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
  provisioningDetails: LineItemProvisioningSchema.optional(),
});
export type OrderLineItem = z.infer<typeof OrderLineItemSchema>;

/**
 * Wire shape for `GET /orders{,/{id}}`. Reads accept both the legacy Pax8
 * field name (`createdDate`) and the canonical camelCase / past-tense name
 * (`createdAt`). The Zod preprocess maps the legacy wire name onto the
 * canonical field so the parsed object always carries `createdAt`. See #385.
 */
export const OrderSchema = z.preprocess(
  (raw) => {
    if (raw === null || typeof raw !== "object") return raw;
    const r = raw as Record<string, unknown>;
    const createdAt =
      typeof r.createdAt === "string"
        ? r.createdAt
        : typeof r.createdDate === "string"
          ? r.createdDate
          : undefined;
    return {
      ...r,
      ...(createdAt !== undefined ? { createdAt } : {}),
    };
  },
  z.object({
    id: z.string(),
    companyId: z.string(),
    /** Denormalized company name. Returned by the demo client; the real API
     * doesn't include it directly but the CLI populates it after lookup. */
    companyName: z.string().optional(),
    orderedBy: z.string().optional(),
    /** Denormalized email of the placing user (demo data convenience). */
    orderedByEmail: z.string().optional(),
    status: z.string().optional(),
    /**
     * Canonical timestamp the order was placed (camelCase, past tense,
     * ISO 8601 string).
     */
    createdAt: z.string(),
    lineItems: z.array(OrderLineItemSchema).optional(),
  }),
);
export type Order = z.infer<typeof OrderSchema>;

export const CreateOrderInputSchema = z.object({
  companyId: z.string(),
  lineItems: z.array(OrderLineItemCreateInputSchema).min(1),
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
export const SubscriptionSchema = z.preprocess(
  (raw) => {
    if (raw === null || typeof raw !== "object") return raw;
    const r = raw as Record<string, unknown>;
    // #385: accept both `createdDate` (legacy wire field) and `createdAt`
    // (canonical). Whichever is present wins; the parsed object always
    // carries the canonical `createdAt`.
    const createdAt =
      typeof r.createdAt === "string"
        ? r.createdAt
        : typeof r.createdDate === "string"
          ? r.createdDate
          : undefined;
    return {
      ...r,
      ...(createdAt !== undefined ? { createdAt } : {}),
    };
  },
  z.object({
  id: z.string(),
  companyId: z.string(),
  productId: z.string(),
  quantity: z.number(),
  startDate: z.string(),
  endDate: z.string().optional(),
  /**
   * Canonical timestamp the subscription was created (camelCase, past tense,
   * ISO 8601 string).
   */
  createdAt: z.string(),
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
  }),
);
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

/**
 * Currency-aware money value used by the v2 quoting API. The spec carries
 * the currency code per amount rather than at the quote level, so a single
 * quote could in principle mix currencies across line items — render code
 * should always print the currency alongside the amount.
 *
 * Spec ref: `components.schemas.AmountCurrency` in
 * `https://devx.pax8.com/openapi/quoting-endpoints.json`.
 */
export const AmountCurrencySchema = z.object({
  amount: z.number(),
  currency: z.string(),
});
export type AmountCurrency = z.infer<typeof AmountCurrencySchema>;

/**
 * Server-side totals object the v2 quoting API returns on both quote-level
 * (`QuoteResponse.totals`) and per-line (`LineItemResponse.totals`). Splits
 * one-time charges (`initial*`) from subscription-period charges
 * (`recurring*`). Spec marks every field required; we model the OBJECT as
 * optional on the consuming schemas so a partial / drifted response doesn't
 * cause a hard parse failure — the render layer falls back to the
 * locally-summed line-item subtotals when this object is absent.
 *
 * Cost / Profit / Total fields:
 *   `*Cost`   — Pax8's wholesale (partner-cost) leg
 *   `*Profit` — partner-side margin amount
 *   `*Total`  — cost + profit (the customer-facing total)
 *
 * Spec ref: `components.schemas.InvoiceTotals` in
 * `https://devx.pax8.com/openapi/quoting-endpoints.json`.
 */
export const InvoiceTotalsSchema = z.object({
  initialCost: AmountCurrencySchema,
  initialProfit: AmountCurrencySchema,
  initialTotal: AmountCurrencySchema,
  recurringCost: AmountCurrencySchema,
  recurringProfit: AmountCurrencySchema,
  recurringTotal: AmountCurrencySchema,
});
export type InvoiceTotals = z.infer<typeof InvoiceTotalsSchema>;

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
  /**
   * Server-side per-line totals. Modeled optional for defensive parsing —
   * the spec marks it required but we don't want a transiently-missing field
   * to fail the whole quotes payload. Render code uses `subtotal` as the
   * fallback when this is absent.
   */
  totals: InvoiceTotalsSchema.optional(),
  /**
   * Server-side commitment term attached to the line item — `{ id, term }`
   * (shape matches `CommitmentTerm` in the v2 quoting spec). Canonical on the
   * v2 read surface per QUOTE-311, QUOTE-1283, and the Spike: Public APIs page
   * (Quoting space). Microsoft NCE and other commitment-priced SKUs persist
   * the commitment-at-quote-time on the line item itself so the eventual order
   * inherits the right rate (Model A canonical; see NCE proration spike).
   *
   * Reuses `CommitmentSchema` rather than defining a new shape: the v2 wire
   * field carries `{ id, term }` (no endDate), and `CommitmentSchema` makes
   * both optional + adds an optional `endDate` so it parses cleanly without
   * forcing a divergent definition.
   */
  commitmentTerm: CommitmentSchema.nullable().optional(),
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
 * Wire shape for the nested `client` object on `GET /v2/quotes` /
 * `GET /v2/quotes/{id}`. Per `quoting-endpoints.json` →
 * `components.schemas.ClientDetails`, this is `{ id, isShadowCompany, name }`.
 *
 * The CLI surfaces these as flat fields (`companyId`, `clientIsShadow`,
 * `clientName`) for ergonomic JSON output and downstream consumers that look
 * up `companyId` directly. See `QuoteSchema`'s preprocess step for the
 * flattening.
 */
export const QuoteClientSchema = z.object({
  id: z.string(),
  isShadowCompany: z.boolean().optional(),
  name: z.string().optional(),
});
export type QuoteClient = z.infer<typeof QuoteClientSchema>;

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
 *
 * Wire-shape note (#384): the v2 quoting API returns `client: {id, ...}` as a
 * nested object, not a flat `companyId`. We `preprocess` the raw payload to
 * flatten `client.id → companyId` (and surface `client.name` / `client.
 * isShadowCompany` as flat optional fields) before object validation. Demo
 * data emits the same wire shape so demo and real-API output stay
 * indistinguishable downstream. Legacy callers that hand-construct a flat
 * `companyId` (older fixtures, the `QuotesApi` test mocks) still parse
 * because the preprocess falls through to whatever's already on the input
 * when `client` is absent.
 */
export const QuoteSchema = z.preprocess(
  (raw) => {
    if (raw === null || typeof raw !== "object") return raw;
    const r = raw as Record<string, unknown>;
    // Stage 1: flatten the nested `client` object (if present) — #384.
    // If wire has nested `client`, surface its fields as flat aliases.
    // If `client` is absent (legacy flat input), pass through unchanged.
    const client = r.client as
      | { id?: string; isShadowCompany?: boolean; name?: string }
      | undefined;
    let working: Record<string, unknown>;
    if (client && typeof client === "object") {
      const { client: _client, ...rest } = r;
      void _client;
      working = {
        ...rest,
        // `client.id` wins over an explicit `companyId` — the wire is the
        // authority. Falls through to existing `companyId` if `client.id`
        // is missing (defensive; the spec marks it required).
        companyId: client.id ?? r.companyId,
        clientIsShadow:
          typeof client.isShadowCompany === "boolean"
            ? client.isShadowCompany
            : r.clientIsShadow,
        clientName:
          typeof client.name === "string" ? client.name : r.clientName,
      };
    } else {
      working = { ...r };
    }
    // Stage 2: canonicalize timestamp field names — #385. Accept BOTH the
    // legacy quoting-v2 names (`createdOn`, `expiresOn`) and the canonical
    // camelCase / past-tense names (`createdAt`, `expiresAt`). The parsed
    // object always carries the canonical names.
    const createdAt =
      typeof working.createdAt === "string"
        ? working.createdAt
        : typeof working.createdOn === "string"
          ? working.createdOn
          : undefined;
    const expiresAt =
      typeof working.expiresAt === "string"
        ? working.expiresAt
        : typeof working.expiresOn === "string"
          ? working.expiresOn
          : undefined;
    if (createdAt !== undefined) {
      working.createdAt = createdAt;
      delete working.createdOn;
    }
    if (expiresAt !== undefined) {
      working.expiresAt = expiresAt;
      delete working.expiresOn;
    }
    return working;
  },
  z.object({
    id: z.string(),
    companyId: z.string(),
    /**
     * Flattened from wire `client.name`. Optional because the spec marks it
     * required on the nested object but legacy/demo inputs that bypass the
     * preprocess (flat-shape) don't carry it.
     */
    clientName: z.string().optional(),
    /**
     * Flattened from wire `client.isShadowCompany`. Optional for the same
     * reason as `clientName` — and because the field semantics (the client
     * is a Pax8-internal shadow record vs. a partner-owned company) are
     * informational, not load-bearing for any current CLI command.
     */
    clientIsShadow: z.boolean().optional(),
    /**
     * Canonical timestamp the quote was created (camelCase, past tense,
     * ISO 8601 string).
     */
    createdAt: z.string(),
    /**
     * Canonical expiration timestamp.
     */
    expiresAt: z.string().optional(),
    status: z.string(),
    lineItems: z.array(QuoteLineItemSchema).optional(),

    // The two free-text body fields the v2 quoting API marks as required on the
    // `QuoteResponse` shape AND on the `PUT /v2/quotes/{quoteId}` request body.
    // The CLI doesn't expose either as a user-settable flag today, but both must
    // be modeled on the read shape so the fetch-then-merge in `update` /
    // `setStatus` can round-trip the server-side values back without dropping
    // them. See #313, #314 and `docs/triage/quotes-api-version.md` §9.1.
    introMessage: z.string(),
    termsAndDisclaimers: z.string(),

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
    /**
     * Server-side quote-level totals. Splits one-time (`initial*`) from
     * subscription-period (`recurring*`) buckets, each carrying cost,
     * profit, and total amounts with currency. Modeled optional so a partial
     * / drifted API response doesn't fail the whole quote parse — the
     * render layer falls back to locally-summed line subtotals when this
     * is absent. Spec marks the field required.
     */
    totals: InvoiceTotalsSchema.optional(),
  }),
);
export type Quote = z.infer<typeof QuoteSchema>;

// ─── Webhook ─────────────────────────────────────────────────────────────────

/**
 * Wire shape for `GET /webhooks{,/{id}}`. Webhook's `updatedAt` is already
 * canonical. Reads accept both the legacy Pax8 field name (`createdDate`)
 * and the canonical camelCase / past-tense name (`createdAt`). The Zod
 * preprocess maps the legacy wire name onto the canonical field so the
 * parsed object always carries `createdAt`. See #385.
 */
export const WebhookSchema = z.preprocess(
  (raw) => {
    if (raw === null || typeof raw !== "object") return raw;
    const r = raw as Record<string, unknown>;
    const createdAt =
      typeof r.createdAt === "string"
        ? r.createdAt
        : typeof r.createdDate === "string"
          ? r.createdDate
          : undefined;
    return {
      ...r,
      ...(createdAt !== undefined ? { createdAt } : {}),
    };
  },
  z.object({
  id: z.string(),
  url: z.string().url(),
  topics: z.array(z.string()),
  status: WebhookStatusSchema,
  /**
   * Canonical timestamp the webhook was created (camelCase, past tense,
   * ISO 8601 string).
   */
  createdAt: z.string(),
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
  /** ISO timestamp of last update (Pax8 v2.1+). Already canonical per #385. */
  updatedAt: z.string().optional(),
  }),
);
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

/**
 * Body for `POST /v2/quotes` per the public quoting OpenAPI spec (v2.0.0):
 * `{ clientId, quoteRequestId? }`. Line items are **not** accepted on create —
 * they must be added through a separate `POST /v2/quotes/{quoteId}/line-items`
 * call after the quote exists (see `AddQuoteLineItemInputSchema` below).
 *
 * `clientId` is the v2 term for what older Pax8 surfaces (and most other v1
 * endpoints here) call `companyId`. The CLI's `quotes create` command resolves
 * `--company <id|name>` to a company ID and sends it as `clientId`; we don't
 * leak the v2 naming into the user-facing flag vocabulary.
 *
 * See #311 and `docs/triage/quotes-api-version.md` §9.1.
 */
export const CreateQuoteInputSchema = z.object({
  clientId: z.string(),
  quoteRequestId: z.string().optional(),
});
export type CreateQuoteInput = z.infer<typeof CreateQuoteInputSchema>;

/**
 * Status values accepted on `PUT /v2/quotes/{quoteId}`. The `setStatus` /
 * `send` helpers on `QuotesApi` (#314) and the new fetch-then-merge `update`
 * (#313) both ride this enum — every status transition uses the same PUT
 * endpoint and ships the full 5-field body.
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

/**
 * Partial-override input for `QuotesApi.update(id, overrides)`. Every field
 * is optional — `update()` itself does a fetch-then-merge under the hood,
 * filling in whatever the caller doesn't supply from the current server-side
 * quote so the resulting PUT body satisfies the v2 spec's all-five-required
 * contract (`expiresOn`, `introMessage`, `published`, `status`,
 * `termsAndDisclaimers`).
 *
 * Note that `lineItems` is **not** part of this shape: `PUT /v2/quotes/{id}`
 * does not accept a `lineItems` array on the v2 surface. The CLI's
 * line-item-replacement flow decomposes into per-line `DELETE` + `POST` calls
 * against `/v2/quotes/{id}/line-items` instead. See #313 and
 * `docs/triage/quotes-api-version.md` §9.1.
 */
export const UpdateQuoteInputSchema = z.object({
  expiresOn: z.string().optional(),
  introMessage: z.string().optional(),
  published: z.boolean().optional(),
  status: QuoteStatusTransitionSchema.optional(),
  termsAndDisclaimers: z.string().optional(),
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
  /**
   * Optional commitment-term UUID. Pins the line item to a specific
   * commitment-priced rate plan (Microsoft NCE 1-Year, 3-Year, etc.). Per
   * the v2 quoting OpenAPI spec, `AddStandardLineItemPayload.commitmentTermId`
   * is a UUID (`format: uuid`) and is optional on the write surface (not in
   * the required set). Modeled as plain `string` here (not `z.string().uuid()`)
   * to match `OrderLineItemInputSchema.commitmentTermId` — demo fixtures use
   * Pax8-style synthetic IDs (`cterm-...`) that aren't strict RFC-4122 UUIDs,
   * and we treat the wire-format check as the API's job.
   * Internally canonical per QUOTE-311 (the `AddLineItemToQuoteCommandPayload`
   * shape on the quoting service), QUOTE-1283 (`commitmentTerm` persisted on
   * the line item itself), and QUOTE-406 (backfill of older NULL rows). See
   * also the NCE proration spike (Model A canonical: commitment is decided
   * at quote-time and rides through to the order).
   *
   * The CLI accepts the UUID directly via `--commitment-term-id` and also
   * accepts a human-readable enum via `--commitment-term` (Monthly | 1-Year
   * | 3-Year), which the command layer auto-resolves against the partner's
   * existing subscriptions (same pattern orders create uses — see
   * `packages/cli/src/lib/resolve-commitment.ts`).
   */
  commitmentTermId: z.string().optional(),
});
export type AddQuoteLineItemInput = z.infer<typeof AddQuoteLineItemInputSchema>;

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
