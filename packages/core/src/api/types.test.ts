// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Schema validation tests + a CI-enforced "forbidden fields" regression
 * check at the bottom of this file.
 *
 * Forbidden-field hygiene
 * -----------------------
 * Certain field names are PERMANENTLY EXCLUDED from CLI-facing Zod schemas.
 * These are fields that either:
 *
 *  - Leak Pax8's internal cost basis / margin / billing-engine internals
 *    (Tier 1 — Revenue/Competitive — per the Marketplace & Platform Data
 *    Risk Tiering standard at
 *    https://pax8.atlassian.net/wiki/spaces/PS1/pages/2748907531/Marketplace+Platform+Data+Risk+Tiering),
 *    OR
 *  - Were explicitly called out by reviewers as "must never see the light
 *    of day" (Josh Hollander's inline comment on the CLI domain review:
 *    "let's also make sure `originalSubscriptionId` never sees the light
 *    of day. I don't want to double down on that massive mistake.").
 *
 * The list below is **policy as code** — if a future PR adds one of these
 * field names to any exported Zod schema in this file (top-level OR
 * nested), the test at the bottom fails with a clear message naming the
 * field and schema. This catches both "schema drift from upstream API
 * additions" and "well-intentioned but harmful additions" before they
 * land.
 *
 * To add a new field to the forbidden list:
 *   1. Justify it in writing (which tier, which reviewer, which incident)
 *   2. Append to FORBIDDEN_FIELDS below with an inline comment
 *   3. The check is automatic from there.
 *
 * See also: docs/pm-review-response-2026-05.md §1 (field-tier audit) and
 * Pax8 CLI Domain Review at
 * https://pax8.atlassian.net/wiki/spaces/Foundation/pages/3069607971/Pax8+CLI+Domain+Review+Approval+Process+and+Key+Questions+for+Each+Section
 */

import { describe, it, expect } from "vitest";
import { ZodObject } from "zod";
import * as types from "./types.js";
import {
  CompanySchema,
  CreateCompanyInputSchema,
  UpdateCompanyInputSchema,
  ContactSchema,
  CreateContactInputSchema,
  UpdateContactInputSchema,
  ProductSchema,
  ProductPricingResponseSchema,
  ProductPricingPlanSchema,
  ProvisioningDetailSchema,
  OrderSchema,
  OrderLineItemSchema,
  OrderLineItemInputSchema,
  OrderLineItemProvisioningDetailSchema,
  OrderLineItemProvisioningSchema,
  CreateOrderInputSchema,
  SubscriptionSchema,
  UpdateSubscriptionInputSchema,
  SubscriptionHistorySchema,
  InvoiceSchema,
  InvoiceItemSchema,
  UsageSummarySchema,
  UsageLineSchema,
  QuoteSchema,
  WebhookSchema,
  CreateWebhookInputSchema,
  WebhookLogSchema,
  PaginatedResponseSchema,
} from "./types.js";

const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const uuid2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

// ─── Company ─────────────────────────────────────────────────────────────────

describe("CompanySchema", () => {
  const valid = {
    id: uuid,
    name: "Acme Corp",
    address: { street: "123 Main St", city: "Denver", state: "CO", zip: "80202", country: "US" },
    phone: "555-1234",
    website: "https://acme.com",
    status: "Active",
    billOnBehalfOfEnabled: true,
    selfServiceAllowed: false,
    orderApprovalRequired: true,
    created: "2024-01-01T00:00:00Z",
    updatedDate: "2024-06-15T12:00:00Z",
  };

  it("validates a correct payload", () => {
    expect(CompanySchema.parse(valid)).toEqual(valid);
  });

  it("validates minimal payload (only required fields)", () => {
    const minimal = { id: uuid, name: "Acme Corp" };
    expect(CompanySchema.parse(minimal)).toEqual(minimal);
  });

  it("rejects missing id", () => {
    expect(() => CompanySchema.parse({ name: "Acme Corp" })).toThrow();
  });

  it("rejects non-string id", () => {
    // ID schema is `z.string()` (loosened from `.uuid()` in #289 follow-up so
    // human-readable demo IDs like `prod-m365-biz-prem-0001` parse cleanly).
    // Format isn't enforced at the schema layer; the type still must be a string.
    expect(() => CompanySchema.parse({ id: 12345, name: "Acme" })).toThrow();
  });

  it("rejects missing name", () => {
    expect(() => CompanySchema.parse({ id: uuid })).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() => CompanySchema.parse({ id: uuid, name: "Acme", status: "Unknown" })).toThrow();
  });
});

describe("CreateCompanyInputSchema", () => {
  it("validates a correct input", () => {
    const input = { name: "New Corp", phone: "555-9999" };
    expect(CreateCompanyInputSchema.parse(input)).toEqual(input);
  });

  it("rejects empty name", () => {
    expect(() => CreateCompanyInputSchema.parse({ name: "" })).toThrow();
  });

  it("rejects missing name", () => {
    expect(() => CreateCompanyInputSchema.parse({})).toThrow();
  });
});

describe("UpdateCompanyInputSchema", () => {
  it("validates partial update", () => {
    const input = { name: "Updated Corp" };
    expect(UpdateCompanyInputSchema.parse(input)).toEqual(input);
  });

  it("validates empty update (all optional)", () => {
    expect(UpdateCompanyInputSchema.parse({})).toEqual({});
  });
});

// ─── Contact ─────────────────────────────────────────────────────────────────

describe("ContactSchema", () => {
  const valid = {
    id: uuid,
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@acme.com",
    phone: "555-1111",
    companyId: uuid2,
    types: ["Admin", "Billing"],
  };

  it("validates a correct payload", () => {
    expect(ContactSchema.parse(valid)).toEqual(valid);
  });

  it("rejects invalid email", () => {
    expect(() => ContactSchema.parse({ ...valid, email: "not-an-email" })).toThrow();
  });

  it("rejects invalid contact type", () => {
    expect(() => ContactSchema.parse({ ...valid, types: ["Manager"] })).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => ContactSchema.parse({ id: uuid })).toThrow();
  });
});

describe("CreateContactInputSchema", () => {
  it("validates correct input", () => {
    const input = {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@acme.com",
      companyId: uuid,
      types: ["Admin"],
    };
    expect(CreateContactInputSchema.parse(input)).toEqual(input);
  });

  it("rejects empty types array", () => {
    expect(() =>
      CreateContactInputSchema.parse({
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@acme.com",
        companyId: uuid,
        types: [],
      }),
    ).toThrow();
  });
});

describe("UpdateContactInputSchema", () => {
  it("validates partial update", () => {
    expect(UpdateContactInputSchema.parse({ email: "new@acme.com" })).toEqual({
      email: "new@acme.com",
    });
  });

  it("rejects invalid email in update", () => {
    expect(() => UpdateContactInputSchema.parse({ email: "bad" })).toThrow();
  });
});

// ─── Product ─────────────────────────────────────────────────────────────────

describe("ProductSchema", () => {
  const valid = {
    id: uuid,
    name: "Microsoft 365 Business Premium [New Commerce Experience]",
    vendorName: "Microsoft",
    sku: "M365-BP",
    shortDescription: "Cloud productivity suite",
    description: "Full Microsoft 365 Business Premium package",
    unitOfMeasurement: "seat",
  };

  it("validates a correct payload", () => {
    expect(ProductSchema.parse(valid)).toEqual(valid);
  });

  it("validates minimal payload", () => {
    const minimal = { id: uuid, name: "Some Product" };
    expect(ProductSchema.parse(minimal)).toEqual(minimal);
  });

  it("rejects missing name", () => {
    expect(() => ProductSchema.parse({ id: uuid })).toThrow();
  });

  it("rejects non-string id", () => {
    // ID schema is `z.string()` (loosened from `.uuid()` so human-readable
    // demo IDs parse cleanly); the type still must be a string.
    expect(() => ProductSchema.parse({ id: 42, name: "Product" })).toThrow();
  });
});

// ─── Product Pricing ─────────────────────────────────────────────────────────

describe("ProductPricingResponseSchema", () => {
  const validPlan = {
    productId: uuid,
    billingTerm: "Monthly",
    commitmentTerm: "Monthly",
    commitmentTermInMonths: 1,
    type: "Flat",
    unitOfMeasurement: "User",
    rates: [
      { partnerBuyRate: 1.692, suggestedRetailPrice: 1.8, startQuantityRange: 0, chargeType: "Per Unit" },
    ],
  };

  it("validates a correct paginated pricing response", () => {
    const response = { content: [validPlan] };
    const parsed = ProductPricingResponseSchema.parse(response);
    expect(parsed.content).toHaveLength(1);
    expect(parsed.content[0].billingTerm).toBe("Monthly");
    expect(parsed.content[0].commitmentTerm).toBe("Monthly");
  });

  it("validates a pricing plan", () => {
    expect(ProductPricingPlanSchema.parse(validPlan)).toEqual(validPlan);
  });

  it("rejects missing rates", () => {
    expect(() => ProductPricingPlanSchema.parse({ productId: uuid, billingTerm: "Monthly", commitmentTerm: "Monthly" })).toThrow();
  });

  it("rejects missing billingTerm", () => {
    expect(() =>
      ProductPricingPlanSchema.parse({
        productId: uuid,
        commitmentTerm: "Monthly",
        rates: [{ partnerBuyRate: 1.0, suggestedRetailPrice: 1.5 }],
      }),
    ).toThrow();
  });
});

// ─── Provisioning Detail ─────────────────────────────────────────────────────

describe("ProvisioningDetailSchema", () => {
  const valid = {
    productId: uuid,
    vendorPrerequisites: "Must have Azure AD tenant",
    fields: [
      { name: "domain", label: "Domain Name", type: "string", required: true },
      { name: "plan", label: "Plan", type: "select", required: false, options: ["basic", "standard"] },
    ],
  };

  it("validates a correct payload", () => {
    expect(ProvisioningDetailSchema.parse(valid)).toEqual(valid);
  });

  it("validates minimal payload", () => {
    expect(ProvisioningDetailSchema.parse({ productId: uuid })).toEqual({ productId: uuid });
  });
});

// ─── Order ───────────────────────────────────────────────────────────────────

describe("OrderSchema", () => {
  const valid = {
    id: uuid,
    companyId: uuid2,
    orderedBy: "admin@partner.com",
    createdDate: "2024-03-15T10:00:00Z",
    lineItems: [
      {
        id: uuid,
        productId: uuid2,
        quantity: 10,
      },
    ],
  };

  it("validates a correct payload", () => {
    expect(OrderSchema.parse(valid)).toEqual(valid);
  });

  it("validates without lineItems", () => {
    // Strip lineItems via destructure; the unused name is the rest-sibling idiom.
    const { lineItems, ...rest } = valid;
    expect(OrderSchema.parse(rest)).toEqual(rest);
  });

  it("rejects missing companyId", () => {
    expect(() => OrderSchema.parse({ id: uuid, createdDate: "2024-01-01" })).toThrow();
  });
});

describe("OrderLineItemSchema", () => {
  it("validates a correct line item", () => {
    const valid = { id: uuid, productId: uuid2, quantity: 5 };
    expect(OrderLineItemSchema.parse(valid)).toEqual(valid);
  });

  it("rejects missing productId", () => {
    expect(() => OrderLineItemSchema.parse({ id: uuid, quantity: 5 })).toThrow();
  });

  // #332 — `provisioningDetails` is `Array<{key, values: string[]}>` per the
  // public Pax8 OpenAPI spec's `ProvisioningDetail` shape, NOT a free-form
  // `Record<string, unknown>`. Pin the shape going forward.
  it("accepts spec-shaped provisioningDetails array (#332)", () => {
    const valid = {
      id: uuid,
      productId: uuid2,
      quantity: 5,
      provisioningDetails: [
        { key: "domain", values: ["contoso.com"] },
        { key: "region", values: ["us-east", "us-west"] },
      ],
    };
    expect(OrderLineItemSchema.parse(valid)).toEqual(valid);
  });

  it("rejects record-shaped provisioningDetails (#332 — pre-fix shape)", () => {
    expect(() =>
      OrderLineItemSchema.parse({
        id: uuid,
        productId: uuid2,
        quantity: 5,
        provisioningDetails: { domain: "contoso.com" },
      }),
    ).toThrow();
  });
});

describe("OrderLineItemInputSchema", () => {
  const validBase = {
    productId: uuid2,
    lineItemNumber: 1,
    quantity: 5,
  };

  it("accepts spec-shaped provisioningDetails on the wire input (#332)", () => {
    const valid = {
      ...validBase,
      provisioningDetails: [{ key: "domain", values: ["contoso.com"] }],
    };
    expect(OrderLineItemInputSchema.parse(valid)).toEqual(valid);
  });

  it("rejects record-shaped provisioningDetails on the wire input (#332)", () => {
    expect(() =>
      OrderLineItemInputSchema.parse({
        ...validBase,
        provisioningDetails: { domain: "contoso.com" },
      }),
    ).toThrow();
  });

  it("rejects non-string `values` entries (#332)", () => {
    expect(() =>
      OrderLineItemInputSchema.parse({
        ...validBase,
        provisioningDetails: [{ key: "domain", values: [123] }],
      }),
    ).toThrow();
  });

  it("allows omitting provisioningDetails entirely (optional)", () => {
    expect(OrderLineItemInputSchema.parse(validBase)).toEqual(validBase);
  });
});

describe("OrderLineItemProvisioningDetailSchema (#332)", () => {
  it("requires both key and values", () => {
    const valid = { key: "domain", values: ["contoso.com"] };
    expect(OrderLineItemProvisioningDetailSchema.parse(valid)).toEqual(valid);
  });

  it("accepts multiple values per key", () => {
    const valid = { key: "region", values: ["us-east", "us-west", "eu-west"] };
    expect(OrderLineItemProvisioningDetailSchema.parse(valid)).toEqual(valid);
  });

  it("allows an empty values array (spec doesn't require non-empty)", () => {
    const valid = { key: "feature-flag", values: [] };
    expect(OrderLineItemProvisioningDetailSchema.parse(valid)).toEqual(valid);
  });

  it("rejects missing key", () => {
    expect(() =>
      OrderLineItemProvisioningDetailSchema.parse({ values: ["x"] }),
    ).toThrow();
  });

  it("rejects missing values array", () => {
    expect(() =>
      OrderLineItemProvisioningDetailSchema.parse({ key: "domain" }),
    ).toThrow();
  });

  it("rejects non-string values", () => {
    expect(() =>
      OrderLineItemProvisioningDetailSchema.parse({ key: "domain", values: [42] }),
    ).toThrow();
  });
});

describe("OrderLineItemProvisioningSchema (#332)", () => {
  it("is an array of provisioning details", () => {
    const valid = [
      { key: "domain", values: ["contoso.com"] },
      { key: "tier", values: ["premium"] },
    ];
    expect(OrderLineItemProvisioningSchema.parse(valid)).toEqual(valid);
  });

  it("accepts an empty array (no provisioning details required)", () => {
    expect(OrderLineItemProvisioningSchema.parse([])).toEqual([]);
  });

  it("rejects a record / object map (the pre-#332 shape)", () => {
    expect(() =>
      OrderLineItemProvisioningSchema.parse({ domain: "contoso.com" }),
    ).toThrow();
  });
});

describe("CreateOrderInputSchema", () => {
  it("validates a correct order input", () => {
    const input = {
      companyId: uuid,
      lineItems: [{ productId: uuid2, quantity: 5 }],
    };
    expect(CreateOrderInputSchema.parse(input)).toEqual(input);
  });

  it("rejects empty lineItems", () => {
    expect(() =>
      CreateOrderInputSchema.parse({ companyId: uuid, lineItems: [] }),
    ).toThrow();
  });

  it("rejects lineItem with zero quantity", () => {
    expect(() =>
      CreateOrderInputSchema.parse({
        companyId: uuid,
        lineItems: [{ productId: uuid2, quantity: 0 }],
      }),
    ).toThrow();
  });
});

// ─── Subscription ────────────────────────────────────────────────────────────

describe("SubscriptionSchema", () => {
  const valid = {
    id: uuid,
    companyId: uuid2,
    productId: uuid,
    quantity: 45,
    startDate: "2024-01-01T00:00:00Z",
    endDate: "2025-01-01T00:00:00Z",
    createdDate: "2023-12-15T00:00:00Z",
    billingStart: "2024-01-01T00:00:00Z",
    status: "Active",
    price: 22.5,
    billingTerm: "Annual",
    commitmentTermEndDate: "2025-01-01T00:00:00Z",
    companyName: "Acme Corp",
    productName: "Microsoft 365 Business Premium [New Commerce Experience]",
  };

  it("validates a correct payload", () => {
    expect(SubscriptionSchema.parse(valid)).toEqual(valid);
  });

  it("validates minimal payload", () => {
    const minimal = {
      id: uuid,
      companyId: uuid2,
      productId: uuid,
      quantity: 10,
      startDate: "2024-01-01",
      createdDate: "2024-01-01",
      status: "Active",
    };
    expect(SubscriptionSchema.parse(minimal)).toEqual(minimal);
  });

  it("rejects invalid status", () => {
    expect(() =>
      SubscriptionSchema.parse({
        id: uuid,
        companyId: uuid2,
        productId: uuid,
        quantity: 10,
        startDate: "2024-01-01",
        createdDate: "2024-01-01",
        status: "Suspended",
      }),
    ).toThrow();
  });

  it("rejects invalid billingTerm", () => {
    expect(() =>
      SubscriptionSchema.parse({
        id: uuid,
        companyId: uuid2,
        productId: uuid,
        quantity: 10,
        startDate: "2024-01-01",
        createdDate: "2024-01-01",
        status: "Active",
        billingTerm: "Weekly",
      }),
    ).toThrow();
  });
});

describe("UpdateSubscriptionInputSchema", () => {
  it("validates quantity update", () => {
    expect(UpdateSubscriptionInputSchema.parse({ quantity: 50 })).toEqual({ quantity: 50 });
  });

  it("validates billingTerm update", () => {
    expect(UpdateSubscriptionInputSchema.parse({ billingTerm: "Monthly" })).toEqual({
      billingTerm: "Monthly",
    });
  });

  it("rejects quantity of zero", () => {
    expect(() => UpdateSubscriptionInputSchema.parse({ quantity: 0 })).toThrow();
  });

  it("rejects negative quantity", () => {
    expect(() => UpdateSubscriptionInputSchema.parse({ quantity: -5 })).toThrow();
  });

  it("rejects non-integer quantity", () => {
    expect(() => UpdateSubscriptionInputSchema.parse({ quantity: 5.5 })).toThrow();
  });
});

// ─── Subscription History ────────────────────────────────────────────────────

describe("SubscriptionHistorySchema", () => {
  const valid = {
    id: uuid,
    action: "QuantityChanged",
    date: "2024-06-01T00:00:00Z",
    quantity: 50,
    previousQuantity: 45,
  };

  it("validates a correct payload", () => {
    expect(SubscriptionHistorySchema.parse(valid)).toEqual(valid);
  });

  it("validates without previousQuantity", () => {
    // Strip previousQuantity via destructure; rest-sibling idiom.
    const { previousQuantity, ...rest } = valid;
    expect(SubscriptionHistorySchema.parse(rest)).toEqual(rest);
  });

  it("rejects missing action", () => {
    expect(() => SubscriptionHistorySchema.parse({ id: uuid, date: "2024-01-01", quantity: 10 })).toThrow();
  });
});

// ─── Invoice ─────────────────────────────────────────────────────────────────

describe("InvoiceSchema", () => {
  const valid = {
    id: uuid,
    companyId: uuid2,
    invoiceDate: "2024-03-01",
    dueDate: "2024-03-31",
    status: "Unpaid",
    total: 5000.0,
    balance: 5000.0,
    companyName: "Acme Corp",
  };

  it("validates a correct payload", () => {
    expect(InvoiceSchema.parse(valid)).toEqual(valid);
  });

  it("validates Carried status", () => {
    expect(InvoiceSchema.parse({ ...valid, status: "Carried" })).toEqual({
      ...valid,
      status: "Carried",
    });
  });

  it("validates a payload with missing status (status is optional per spec gap)", () => {
    // Strip status via destructure; rest-sibling idiom.
    const { status, ...rest } = valid;
    expect(InvoiceSchema.parse(rest)).toEqual(rest);
  });

  it("rejects invalid status (Overdue)", () => {
    expect(() => InvoiceSchema.parse({ ...valid, status: "Overdue" })).toThrow();
  });

  it("rejects legacy Carry status (typo replaced by Carried)", () => {
    expect(() => InvoiceSchema.parse({ ...valid, status: "Carry" })).toThrow();
  });

  it("rejects legacy Nothing status (removed dead value)", () => {
    expect(() => InvoiceSchema.parse({ ...valid, status: "Nothing" })).toThrow();
  });

  it("rejects missing total", () => {
    // Strip total via destructure; rest-sibling idiom.
    const { total, ...rest } = valid;
    expect(() => InvoiceSchema.parse(rest)).toThrow();
  });
});

// ─── Invoice Item ────────────────────────────────────────────────────────────

describe("InvoiceItemSchema", () => {
  const valid = {
    id: uuid,
    invoiceId: uuid2,
    productId: uuid,
    subscriptionId: uuid2,
    quantity: 45,
    price: 22.5,
    subTotal: 1012.5,
    companyId: uuid,
    productName: "Microsoft 365 Business Premium [New Commerce Experience]",
    companyName: "Acme Corp",
  };

  it("validates a correct payload", () => {
    expect(InvoiceItemSchema.parse(valid)).toEqual(valid);
  });

  it("validates minimal payload", () => {
    const minimal = {
      id: uuid,
      invoiceId: uuid2,
      productId: uuid,
      quantity: 10,
      price: 5.0,
      subTotal: 50.0,
    };
    expect(InvoiceItemSchema.parse(minimal)).toEqual(minimal);
  });

  it("rejects missing quantity", () => {
    expect(() =>
      InvoiceItemSchema.parse({
        id: uuid,
        invoiceId: uuid2,
        productId: uuid,
        price: 5.0,
        subTotal: 50.0,
      }),
    ).toThrow();
  });
});

// ─── Usage Summary ───────────────────────────────────────────────────────────

describe("UsageSummarySchema", () => {
  const valid = {
    id: uuid,
    companyId: uuid2,
    productId: uuid,
    date: "2024-03-01",
    quantity: 100,
    unitPrice: 0.05,
    subtotal: 5.0,
    resourceGroup: "compute",
    companyName: "Acme Corp",
    productName: "Azure Compute",
  };

  it("validates a correct payload", () => {
    expect(UsageSummarySchema.parse(valid)).toEqual(valid);
  });

  it("validates minimal payload", () => {
    const minimal = {
      id: uuid,
      companyId: uuid2,
      productId: uuid,
      date: "2024-03-01",
      quantity: 100,
      unitPrice: 0.05,
      subtotal: 5.0,
    };
    expect(UsageSummarySchema.parse(minimal)).toEqual(minimal);
  });
});

// ─── Usage Line ──────────────────────────────────────────────────────────────

describe("UsageLineSchema", () => {
  const valid = {
    id: uuid,
    usageSummaryId: uuid2,
    quantity: 50,
    unitPrice: 0.05,
    subtotal: 2.5,
    description: "VM hours",
    date: "2024-03-15",
  };

  it("validates a correct payload", () => {
    expect(UsageLineSchema.parse(valid)).toEqual(valid);
  });

  it("rejects missing date", () => {
    // Strip date via destructure; rest-sibling idiom.
    const { date, ...rest } = valid;
    expect(() => UsageLineSchema.parse(rest)).toThrow();
  });
});

// ─── Quote ───────────────────────────────────────────────────────────────────

describe("QuoteSchema", () => {
  const valid = {
    id: uuid,
    companyId: uuid2,
    createdOn: "2024-03-01",
    expiresOn: "2024-04-01",
    status: "Draft",
    lineItems: [
      { productId: uuid, quantity: 10, billingTerm: "Annual", unitPrice: 22.5, subtotal: 225.0 },
    ],
  };

  it("validates a correct payload", () => {
    expect(QuoteSchema.parse(valid)).toEqual(valid);
  });

  it("validates without lineItems", () => {
    // Strip lineItems via destructure; rest-sibling idiom.
    const { lineItems, ...rest } = valid;
    expect(QuoteSchema.parse(rest)).toEqual(rest);
  });

  it("rejects missing status", () => {
    expect(() =>
      QuoteSchema.parse({ id: uuid, companyId: uuid2, createdOn: "2024-03-01" }),
    ).toThrow();
  });
});

// ─── Webhook ─────────────────────────────────────────────────────────────────

describe("WebhookSchema", () => {
  const valid = {
    id: uuid,
    url: "https://example.com/webhook",
    topics: ["subscription.created", "subscription.updated"],
    status: "Active",
    createdDate: "2024-03-01",
    secret: "whsec_abc123",
  };

  it("validates a correct payload", () => {
    expect(WebhookSchema.parse(valid)).toEqual(valid);
  });

  it("rejects invalid url", () => {
    expect(() => WebhookSchema.parse({ ...valid, url: "not-a-url" })).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() => WebhookSchema.parse({ ...valid, status: "Paused" })).toThrow();
  });

  it("rejects missing topics", () => {
    // Strip topics via destructure; rest-sibling idiom.
    const { topics, ...rest } = valid;
    expect(() => WebhookSchema.parse(rest)).toThrow();
  });
});

describe("CreateWebhookInputSchema (#323)", () => {
  // The Pax8 webhooks v2 spec marks `displayName` required and uses the
  // structured `webhookTopics: Array<{ topic, filters }>` shape. Tests pin
  // both the happy path and the two known rejection cases the issue calls
  // out (missing displayName, wrong topics shape).
  it("validates a spec-shaped create body", () => {
    const input = {
      displayName: "Subscription events",
      url: "https://example.com/webhook",
      webhookTopics: [{ topic: "subscription.created", filters: [] }],
    };
    expect(CreateWebhookInputSchema.parse(input)).toEqual(input);
  });

  it("defaults filters to [] when omitted on a topic entry", () => {
    const input = {
      displayName: "Subscription events",
      url: "https://example.com/webhook",
      webhookTopics: [{ topic: "subscription.created" }],
    };
    const parsed = CreateWebhookInputSchema.parse(input);
    expect(parsed.webhookTopics[0].filters).toEqual([]);
  });

  it("rejects missing displayName (required by spec)", () => {
    expect(() =>
      CreateWebhookInputSchema.parse({
        url: "https://example.com/webhook",
        webhookTopics: [{ topic: "subscription.created", filters: [] }],
      }),
    ).toThrow();
  });

  it("rejects empty webhookTopics", () => {
    expect(() =>
      CreateWebhookInputSchema.parse({
        displayName: "Empty",
        url: "https://example.com/webhook",
        webhookTopics: [],
      }),
    ).toThrow();
  });

  it("rejects invalid url", () => {
    expect(() =>
      CreateWebhookInputSchema.parse({
        displayName: "Bad URL",
        url: "bad",
        webhookTopics: [{ topic: "sub.created", filters: [] }],
      }),
    ).toThrow();
  });

  it("rejects the legacy `topics: string[]` shape (regression guard for #323)", () => {
    expect(() =>
      CreateWebhookInputSchema.parse({
        displayName: "Legacy shape",
        url: "https://example.com/webhook",
        topics: ["subscription.created"],
      }),
    ).toThrow();
  });
});

// ─── Webhook Log ─────────────────────────────────────────────────────────────

describe("WebhookLogSchema", () => {
  const valid = {
    id: uuid,
    webhookId: uuid2,
    topic: "subscription.created",
    responseCode: 200,
    responseBody: '{"ok":true}',
    sentAt: "2024-03-15T10:00:00Z",
  };

  it("validates a correct payload", () => {
    expect(WebhookLogSchema.parse(valid)).toEqual(valid);
  });

  it("rejects missing responseCode", () => {
    // Strip responseCode via destructure; rest-sibling idiom.
    const { responseCode, ...rest } = valid;
    expect(() => WebhookLogSchema.parse(rest)).toThrow();
  });
});

// ─── PaginatedResponse ──────────────────────────────────────────────────────

describe("PaginatedResponseSchema", () => {
  it("works with CompanySchema", () => {
    const schema = PaginatedResponseSchema(CompanySchema);
    const data = {
      page: { size: 10, totalElements: 25, totalPages: 3, number: 0 },
      content: [
        { id: uuid, name: "Acme Corp" },
        { id: uuid2, name: "Contoso Ltd" },
      ],
    };
    expect(schema.parse(data)).toEqual(data);
  });

  it("works with SubscriptionSchema", () => {
    const schema = PaginatedResponseSchema(SubscriptionSchema);
    const data = {
      page: { size: 10, totalElements: 1, totalPages: 1, number: 0 },
      content: [
        {
          id: uuid,
          companyId: uuid2,
          productId: uuid,
          quantity: 10,
          startDate: "2024-01-01",
          createdDate: "2024-01-01",
          status: "Active",
        },
      ],
    };
    expect(schema.parse(data)).toEqual(data);
  });

  it("works with empty content", () => {
    const schema = PaginatedResponseSchema(CompanySchema);
    const data = {
      page: { size: 10, totalElements: 0, totalPages: 0, number: 0 },
      content: [],
    };
    expect(schema.parse(data)).toEqual(data);
  });

  it("rejects missing page info", () => {
    const schema = PaginatedResponseSchema(CompanySchema);
    expect(() => schema.parse({ content: [] })).toThrow();
  });

  it("rejects invalid page info", () => {
    const schema = PaginatedResponseSchema(CompanySchema);
    expect(() =>
      schema.parse({
        page: { size: "ten", totalElements: 0, totalPages: 0, number: 0 },
        content: [],
      }),
    ).toThrow();
  });

  it("rejects invalid items in content", () => {
    const schema = PaginatedResponseSchema(CompanySchema);
    // CompanySchema.id is `z.string()` (UUID format isn't enforced); the
    // content item must still satisfy the rest of the shape (e.g. `name`
    // is required, types must match).
    expect(() =>
      schema.parse({
        page: { size: 10, totalElements: 1, totalPages: 1, number: 0 },
        content: [{ id: uuid /* missing name */ }],
      }),
    ).toThrow();
  });

  it("works with InvoiceSchema", () => {
    const schema = PaginatedResponseSchema(InvoiceSchema);
    const data = {
      page: { size: 10, totalElements: 1, totalPages: 1, number: 0 },
      content: [
        {
          id: uuid,
          companyId: uuid2,
          invoiceDate: "2024-03-01",
          dueDate: "2024-03-31",
          status: "Paid",
          total: 1500.0,
          balance: 0,
        },
      ],
    };
    expect(schema.parse(data)).toEqual(data);
  });
});

// ─── Forbidden-field hygiene ─────────────────────────────────────────────────
//
// See the top-of-file comment for rationale. This test walks every exported
// Zod schema in this module (top-level + nested through optional / nullable
// / default / array / union wrappers) and asserts that none of the
// permanently-excluded field names appear.
//
// Adding a new schema to types.ts? You don't need to update anything here —
// the check picks up new exports automatically.
//
// Adding a new forbidden field? Append to FORBIDDEN_FIELDS below with an
// inline justification comment.

const FORBIDDEN_FIELDS = [
  // "Let's also make sure `originalSubscriptionId` never sees the light of
  // day" — Josh Hollander, inline review comment. Surfaced from a prior
  // platform incident; partners must never see it.
  "originalSubscriptionId",
  // Internal subscription hierarchy reference. Reveals how Pax8 structures
  // subscription relationships internally; out of scope for partner-facing
  // surfaces. Hidden per the field-tier audit.
  "parentSubscriptionId",
  // Cross-vendor subscription mapping. Available on Microsoft via UPS-1751
  // but the CLI deliberately omits it; Josh Hollander approved the choice
  // on the domain review page.
  "vendorSubscriptionId",
  // Pax8's cost basis from the vendor. Tier 1 (Revenue/Competitive) —
  // direct margin disclosure.
  "partnerCost",
  // Pax8's wholesale rate from the vendor. Tier 1 — same concern as
  // partnerCost. The partner sees their own buy rate (price /
  // partnerBuyRate); they must never see what Pax8 pays the vendor.
  "wholesaleBuyRate",
  // Invoice-level cost basis. Surfaced by Rovo as one of the fields the
  // partner-safe invoice summary endpoint deliberately omits to avoid
  // wholesale cost leakage (per Finance Services PRD).
  "costTotal",
  // Internal billing-engine fee surface. Same Finance Services exclusion
  // rationale as costTotal.
  "billingFee",
] as const;

/**
 * Walk a Zod schema and yield every ZodObject shape encountered, recursing
 * through common wrappers (optional, nullable, default, array, union,
 * discriminated union, intersection). Yields `{ path, keys }` so violations
 * can name the exact location (e.g. `SubscriptionSchema.commitment`).
 */
function* walkObjectShapes(
  schema: unknown,
  path: string,
  visited: WeakSet<object>,
): Generator<{ path: string; keys: string[] }> {
  if (!schema || typeof schema !== "object") return;
  if (visited.has(schema)) return;
  visited.add(schema);

  if (schema instanceof ZodObject) {
    const shape = schema.shape as Record<string, unknown>;
    yield { path, keys: Object.keys(shape) };
    for (const [key, child] of Object.entries(shape)) {
      yield* walkObjectShapes(child, `${path}.${key}`, visited);
    }
    return;
  }

  // Unwrap common wrappers via `_def`. Zod doesn't expose a uniform
  // "innerType" accessor; we probe the well-known property names.
  const def = (
    schema as {
      _def?: {
        innerType?: unknown;
        type?: unknown;
        options?: unknown[];
        left?: unknown;
        right?: unknown;
      };
    }
  )._def;
  if (!def) return;
  if (def.innerType) {
    yield* walkObjectShapes(def.innerType, path, visited);
  }
  if (def.type) {
    yield* walkObjectShapes(def.type, `${path}[*]`, visited);
  }
  if (Array.isArray(def.options)) {
    for (const opt of def.options) {
      yield* walkObjectShapes(opt, path, visited);
    }
  }
  if (def.left) yield* walkObjectShapes(def.left, path, visited);
  if (def.right) yield* walkObjectShapes(def.right, path, visited);
}

describe("forbidden field hygiene (CI-enforced policy)", () => {
  it("no exported Zod schema exposes a forbidden field", () => {
    const violations: string[] = [];

    for (const [exportName, exportValue] of Object.entries(types)) {
      // Skip non-schema exports: type aliases evaporate at runtime; primitive
      // values (strings, numbers, enums-as-arrays) aren't schemas.
      if (!exportValue || typeof exportValue !== "object") continue;

      const visited = new WeakSet<object>();
      for (const { path, keys } of walkObjectShapes(
        exportValue,
        exportName,
        visited,
      )) {
        for (const forbidden of FORBIDDEN_FIELDS) {
          if (keys.includes(forbidden)) {
            violations.push(`  "${forbidden}" appears in ${path}`);
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        [
          "Forbidden field(s) found in CLI-facing Zod schemas:",
          ...violations,
          "",
          "These field names are permanently excluded from CLI-facing schemas. See",
          "the top-of-file comment in types.test.ts for the rationale (Tier 1",
          "data, reviewer call-outs, prior incidents). If you genuinely need to",
          "expose one of these, get explicit security review first and update",
          "FORBIDDEN_FIELDS with a written justification.",
        ].join("\n"),
      );
    }
  });

  // Sanity check that the test isn't a no-op — confirms the walker reaches
  // nested object shapes through optional + array wrappers. If this
  // regresses (e.g. the walker is broken and yields nothing), this fires
  // before the policy check passes vacuously.
  it("walker reaches nested ZodObject shapes (sanity check)", () => {
    const visited = new WeakSet<object>();
    const shapes = Array.from(
      walkObjectShapes(types.SubscriptionSchema, "SubscriptionSchema", visited),
    );
    const paths = shapes.map((s) => s.path);
    // SubscriptionSchema has a nested optional `commitment: CommitmentSchema`;
    // the walker must descend into it through the ZodOptional wrapper.
    expect(paths).toContain("SubscriptionSchema");
    expect(paths.some((p) => p.startsWith("SubscriptionSchema.commitment"))).toBe(
      true,
    );
  });
});
