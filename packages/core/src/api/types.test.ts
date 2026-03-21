import { describe, it, expect } from "vitest";
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
  UpdateWebhookInputSchema,
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
    modified: "2024-06-15T12:00:00Z",
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

  it("rejects invalid uuid", () => {
    expect(() => CompanySchema.parse({ id: "not-a-uuid", name: "Acme" })).toThrow();
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
    name: "Microsoft 365 Business Premium",
    vendorName: "Microsoft",
    vendor: "microsoft",
    sku: "M365-BP",
    shortDescription: "Cloud productivity suite",
    description: "Full Microsoft 365 Business Premium package",
    unitOfMeasurement: "seat",
    categoryName: "Productivity",
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

  it("rejects non-uuid id", () => {
    expect(() => ProductSchema.parse({ id: "abc", name: "Product" })).toThrow();
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
    productName: "Microsoft 365 Business Premium",
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

  it("rejects invalid status", () => {
    expect(() => InvoiceSchema.parse({ ...valid, status: "Overdue" })).toThrow();
  });

  it("rejects missing total", () => {
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
    unitPrice: 22.5,
    subtotal: 1012.5,
    companyId: uuid,
    productName: "Microsoft 365 Business Premium",
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
      unitPrice: 5.0,
      subtotal: 50.0,
    };
    expect(InvoiceItemSchema.parse(minimal)).toEqual(minimal);
  });

  it("rejects missing quantity", () => {
    expect(() =>
      InvoiceItemSchema.parse({
        id: uuid,
        invoiceId: uuid2,
        productId: uuid,
        unitPrice: 5.0,
        subtotal: 50.0,
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
    const { date, ...rest } = valid;
    expect(() => UsageLineSchema.parse(rest)).toThrow();
  });
});

// ─── Quote ───────────────────────────────────────────────────────────────────

describe("QuoteSchema", () => {
  const valid = {
    id: uuid,
    companyId: uuid2,
    createdDate: "2024-03-01",
    expirationDate: "2024-04-01",
    status: "Draft",
    lineItems: [
      { productId: uuid, quantity: 10, billingTerm: "Annual", unitPrice: 22.5, subtotal: 225.0 },
    ],
  };

  it("validates a correct payload", () => {
    expect(QuoteSchema.parse(valid)).toEqual(valid);
  });

  it("validates without lineItems", () => {
    const { lineItems, ...rest } = valid;
    expect(QuoteSchema.parse(rest)).toEqual(rest);
  });

  it("rejects missing status", () => {
    expect(() =>
      QuoteSchema.parse({ id: uuid, companyId: uuid2, createdDate: "2024-03-01" }),
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
    const { topics, ...rest } = valid;
    expect(() => WebhookSchema.parse(rest)).toThrow();
  });
});

describe("CreateWebhookInputSchema", () => {
  it("validates correct input", () => {
    const input = {
      url: "https://example.com/webhook",
      topics: ["subscription.created"],
    };
    expect(CreateWebhookInputSchema.parse(input)).toEqual(input);
  });

  it("rejects empty topics", () => {
    expect(() =>
      CreateWebhookInputSchema.parse({
        url: "https://example.com/webhook",
        topics: [],
      }),
    ).toThrow();
  });

  it("rejects invalid url", () => {
    expect(() =>
      CreateWebhookInputSchema.parse({ url: "bad", topics: ["sub.created"] }),
    ).toThrow();
  });
});

describe("UpdateWebhookInputSchema", () => {
  it("validates partial update", () => {
    expect(UpdateWebhookInputSchema.parse({ status: "Disabled" })).toEqual({
      status: "Disabled",
    });
  });

  it("validates empty update", () => {
    expect(UpdateWebhookInputSchema.parse({})).toEqual({});
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
    expect(() =>
      schema.parse({
        page: { size: 10, totalElements: 1, totalPages: 1, number: 0 },
        content: [{ id: "not-a-uuid", name: "Bad Company" }],
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
