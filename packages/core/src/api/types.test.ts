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
 *    of day" (inline review comment on the CLI domain review: "let's also
 *    make sure `originalSubscriptionId` never sees the light of day. I
 *    don't want to double down on that massive mistake.").
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
  LineItemProvisioningDetailSchema,
  LineItemProvisioningSchema,
  CreateOrderInputSchema,
  CreateQuoteInputSchema,
  UpdateQuoteInputSchema,
  AddQuoteLineItemInputSchema,
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
    address: { street: "123 Main St", city: "Denver", stateOrProvince: "CO", postalCode: "80202", country: "US" },
    phone: "555-1234",
    website: "https://acme.com",
    status: "Active",
    billOnBehalfOfEnabled: true,
    selfServiceAllowed: false,
    orderApprovalRequired: true,
    created: "2024-01-01T00:00:00Z",
    updatedDate: "2024-06-15T12:00:00Z",
  };

  it("accepts the legacy `created` / `updatedDate` wire shape and projects to canonical (#385)", () => {
    const parsed = CompanySchema.parse(valid);
    // The schema accepts the legacy Pax8-API field names on the wire and
    // projects them onto the canonical camelCase / past-tense names. Only
    // the canonical names survive on the parsed object.
    expect(parsed.createdAt).toBe(valid.created);
    expect(parsed.updatedAt).toBe(valid.updatedDate);
    expect(parsed).not.toHaveProperty("created");
    expect(parsed).not.toHaveProperty("updatedDate");
  });

  it("accepts the canonical `createdAt` / `updatedAt` wire shape (#385)", () => {
    const canonical = {
      ...valid,
      created: undefined,
      updatedDate: undefined,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-06-15T12:00:00Z",
    };
    const parsed = CompanySchema.parse(canonical);
    expect(parsed.createdAt).toBe("2024-01-01T00:00:00Z");
    expect(parsed.updatedAt).toBe("2024-06-15T12:00:00Z");
    expect(parsed).not.toHaveProperty("created");
    expect(parsed).not.toHaveProperty("updatedDate");
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
  // The spec marks `name`, `address`, `phone`, `website`, and the three
  // billing booleans as required (#329). Optional `.optional()` slipped
  // through pre-#327/#329, so these tests pin the contract.
  const validInput = {
    name: "New Corp",
    phone: "555-9999",
    website: "https://newcorp.example.com",
    address: {
      street: "1 Main",
      city: "Denver",
      stateOrProvince: "CO",
      postalCode: "80202",
      country: "US",
    },
    billOnBehalfOfEnabled: false,
    selfServiceAllowed: false,
    orderApprovalRequired: false,
  };

  it("validates a correct input", () => {
    expect(CreateCompanyInputSchema.parse(validInput)).toEqual(validInput);
  });

  it("rejects empty name", () => {
    expect(() => CreateCompanyInputSchema.parse({ ...validInput, name: "" })).toThrow();
  });

  it("rejects missing name", () => {
    const { name: _name, ...rest } = validInput;
    void _name;
    expect(() => CreateCompanyInputSchema.parse(rest)).toThrow();
  });

  it("rejects missing phone", () => {
    const { phone: _phone, ...rest } = validInput;
    void _phone;
    expect(() => CreateCompanyInputSchema.parse(rest)).toThrow();
  });

  it("rejects missing website", () => {
    const { website: _website, ...rest } = validInput;
    void _website;
    expect(() => CreateCompanyInputSchema.parse(rest)).toThrow();
  });

  it("rejects missing billOnBehalfOfEnabled", () => {
    const { billOnBehalfOfEnabled: _b, ...rest } = validInput;
    void _b;
    expect(() => CreateCompanyInputSchema.parse(rest)).toThrow();
  });

  it("rejects missing selfServiceAllowed", () => {
    const { selfServiceAllowed: _s, ...rest } = validInput;
    void _s;
    expect(() => CreateCompanyInputSchema.parse(rest)).toThrow();
  });

  it("rejects missing orderApprovalRequired", () => {
    const { orderApprovalRequired: _o, ...rest } = validInput;
    void _o;
    expect(() => CreateCompanyInputSchema.parse(rest)).toThrow();
  });

  it("accepts an absent address (handler-layer validation per #329)", () => {
    // Address is `.optional()` at the type layer so the no-address branch
    // doesn't produce a degenerate empty object on the wire. The CLI's
    // `companies create` handler fail-fasts before this is reached.
    const { address: _addr, ...rest } = validInput;
    void _addr;
    expect(() => CreateCompanyInputSchema.parse(rest)).not.toThrow();
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
  // Spec shape (#325): `types` is `Array<{type, primary}>` per
  // `components.schemas.ContactType` in the Pax8 public OpenAPI spec, not a
  // flat array of kind enum strings.
  const valid = {
    id: uuid,
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@acme.com",
    phone: "555-1111",
    companyId: uuid2,
    types: [
      { type: "Admin", primary: true },
      { type: "Billing", primary: false },
    ],
  };

  it("validates a correct payload", () => {
    expect(ContactSchema.parse(valid)).toEqual(valid);
  });

  it("rejects invalid email", () => {
    expect(() => ContactSchema.parse({ ...valid, email: "not-an-email" })).toThrow();
  });

  it("rejects invalid contact type kind", () => {
    expect(() =>
      ContactSchema.parse({ ...valid, types: [{ type: "Manager", primary: false }] }),
    ).toThrow();
  });

  it("rejects bare-string entries in types (legacy shape, pre-#325)", () => {
    expect(() => ContactSchema.parse({ ...valid, types: ["Admin"] })).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => ContactSchema.parse({ id: uuid })).toThrow();
  });
});

describe("CreateContactInputSchema", () => {
  it("validates correct input (no companyId in body; types as objects; phone required)", () => {
    const input = {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@acme.com",
      phone: "555-1111",
      types: [{ type: "Admin" as const, primary: false }],
    };
    expect(CreateContactInputSchema.parse(input)).toEqual(input);
  });

  it("rejects missing phone (spec marks it required, #325)", () => {
    expect(() =>
      CreateContactInputSchema.parse({
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@acme.com",
        types: [{ type: "Admin" as const, primary: false }],
      }),
    ).toThrow();
  });

  it("rejects bare-string entries in types (legacy shape, pre-#325)", () => {
    expect(() =>
      CreateContactInputSchema.parse({
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@acme.com",
        phone: "555-1111",
        types: ["Admin"],
      }),
    ).toThrow();
  });

  it("rejects empty types array", () => {
    expect(() =>
      CreateContactInputSchema.parse({
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@acme.com",
        phone: "555-1111",
        types: [],
      }),
    ).toThrow();
  });
});

describe("UpdateContactInputSchema", () => {
  it("requires the full Contact-shaped body (#325 — spec uses PUT, not PATCH)", () => {
    const full = {
      firstName: "Jane",
      lastName: "Doe",
      email: "new@acme.com",
      phone: "555-1111",
    };
    expect(UpdateContactInputSchema.parse(full)).toEqual(full);
  });

  it("rejects partial bodies — fetch-then-merge happens in the handler", () => {
    expect(() => UpdateContactInputSchema.parse({ email: "new@acme.com" })).toThrow();
  });

  it("rejects invalid email", () => {
    expect(() =>
      UpdateContactInputSchema.parse({
        firstName: "Jane",
        lastName: "Doe",
        email: "bad",
        phone: "555-1111",
      }),
    ).toThrow();
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

describe("ProvisioningDetailSchema (spec-shaped, see Candidate H)", () => {
  it("validates a full Input-type field with null possibleValues", () => {
    const detail = {
      key: "domain",
      label: "Tenant Domain",
      description: "Customer's verified Microsoft tenant domain.",
      valueType: "Input" as const,
      possibleValues: null,
    };
    expect(ProvisioningDetailSchema.parse(detail)).toEqual(detail);
  });

  it("validates a Single-Value field with allowed possibleValues", () => {
    const detail = {
      key: "plan",
      label: "Plan",
      valueType: "Single-Value" as const,
      possibleValues: ["basic", "standard"],
    };
    expect(ProvisioningDetailSchema.parse(detail)).toEqual(detail);
  });

  it("validates a Multi-Value field", () => {
    const detail = {
      key: "regions",
      valueType: "Multi-Value" as const,
      possibleValues: ["us-east", "us-west", "eu-central"],
    };
    expect(ProvisioningDetailSchema.parse(detail)).toEqual(detail);
  });

  it("accepts writeOnly values array (orders / sub-update echo path)", () => {
    const echoed = { key: "domain", values: ["contoso.onmicrosoft.com"] };
    expect(ProvisioningDetailSchema.parse(echoed)).toEqual(echoed);
  });

  it("rejects a valueType outside the spec enum", () => {
    expect(() =>
      ProvisioningDetailSchema.parse({ key: "x", valueType: "Freeform" })
    ).toThrow();
  });

  it("validates an empty object — all fields are optional in the spec", () => {
    expect(ProvisioningDetailSchema.parse({})).toEqual({});
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

  it("accepts the legacy `createdDate` wire shape and projects to canonical (#385)", () => {
    const parsed = OrderSchema.parse(valid);
    expect(parsed.createdAt).toBe(valid.createdDate);
    expect(parsed).not.toHaveProperty("createdDate");
  });

  it("accepts the canonical `createdAt` wire shape (#385)", () => {
    const canonical = {
      id: uuid,
      companyId: uuid2,
      orderedBy: "admin@partner.com",
      createdAt: "2024-03-15T10:00:00Z",
    };
    const parsed = OrderSchema.parse(canonical);
    expect(parsed.createdAt).toBe("2024-03-15T10:00:00Z");
    expect(parsed).not.toHaveProperty("createdDate");
  });

  it("validates without lineItems", () => {
    // Strip lineItems via destructure; the unused name is the rest-sibling idiom.
    const { lineItems, ...rest } = valid;
    const parsed = OrderSchema.parse(rest);
    expect(parsed.createdAt).toBe(rest.createdDate);
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

describe("LineItemProvisioningDetailSchema (#332 / renamed #356)", () => {
  it("requires both key and values", () => {
    const valid = { key: "domain", values: ["contoso.com"] };
    expect(LineItemProvisioningDetailSchema.parse(valid)).toEqual(valid);
  });

  it("accepts multiple values per key", () => {
    const valid = { key: "region", values: ["us-east", "us-west", "eu-west"] };
    expect(LineItemProvisioningDetailSchema.parse(valid)).toEqual(valid);
  });

  it("allows an empty values array (spec doesn't require non-empty)", () => {
    const valid = { key: "feature-flag", values: [] };
    expect(LineItemProvisioningDetailSchema.parse(valid)).toEqual(valid);
  });

  it("rejects missing key", () => {
    expect(() =>
      LineItemProvisioningDetailSchema.parse({ values: ["x"] }),
    ).toThrow();
  });

  it("rejects missing values array", () => {
    expect(() =>
      LineItemProvisioningDetailSchema.parse({ key: "domain" }),
    ).toThrow();
  });

  it("rejects non-string values", () => {
    expect(() =>
      LineItemProvisioningDetailSchema.parse({ key: "domain", values: [42] }),
    ).toThrow();
  });

  // Pre-#356 export name must keep resolving to the same schema so embedders
  // that imported `OrderLineItemProvisioningDetailSchema` from `@pax8/core`
  // continue to work after the rename.
  it("is exported under the pre-#356 alias `OrderLineItemProvisioningDetailSchema`", () => {
    expect(OrderLineItemProvisioningDetailSchema).toBe(
      LineItemProvisioningDetailSchema,
    );
  });
});

describe("LineItemProvisioningSchema (#332 / renamed #356)", () => {
  it("is an array of provisioning details", () => {
    const valid = [
      { key: "domain", values: ["contoso.com"] },
      { key: "tier", values: ["premium"] },
    ];
    expect(LineItemProvisioningSchema.parse(valid)).toEqual(valid);
  });

  it("accepts an empty array (no provisioning details required)", () => {
    expect(LineItemProvisioningSchema.parse([])).toEqual([]);
  });

  it("rejects a record / object map (the pre-#332 shape)", () => {
    expect(() =>
      LineItemProvisioningSchema.parse({ domain: "contoso.com" }),
    ).toThrow();
  });

  // Pre-#356 export name must keep resolving to the same schema so embedders
  // that imported `OrderLineItemProvisioningSchema` from `@pax8/core` continue
  // to work after the rename.
  it("is exported under the pre-#356 alias `OrderLineItemProvisioningSchema`", () => {
    expect(OrderLineItemProvisioningSchema).toBe(LineItemProvisioningSchema);
  });
});

// ─── Quotes line-item provisioningDetails (#356) ────────────────────────────
//
// Background: #332 reshaped `OrderLineItemInputSchema.provisioningDetails`
// from the wrong `Record<string, unknown>` shape to the spec-correct
// `Array<{key, values: string[]}>` shape for orders. The agent who fixed it
// flagged the same record/array mismatch on the quotes-side `lineItems[]`
// path as an adjacent finding (PR #351 body, "Scope-honoring callouts").
// #356 is the follow-up.
//
// State of the world at the time of #356:
//
// - `CreateQuoteInputSchema` and `UpdateQuoteInputSchema` no longer carry a
//   `lineItems` field at all. #354 restructured both to match the v2
//   `POST /v2/quotes` (`{ clientId, quoteRequestId? }`) and
//   `PUT /v2/quotes/{id}` (the 5-field full-update body) wire shapes; line
//   items live on the separate `POST /v2/quotes/{id}/line-items` endpoint
//   via `AddQuoteLineItemInputSchema`. So the original defect described in
//   #356 — the `Record<string, unknown>` typing of
//   `CreateQuoteInputSchema.lineItems[].provisioningDetails` — no longer
//   exists as a shape, because the carrier field itself is gone.
//
// - `AddQuoteLineItemInputSchema` (the v2 line-item POST body) intentionally
//   does NOT expose `provisioningDetails` today. The CLI's
//   `quotes line-items add` doesn't surface a `--provisioning` flag, and #356
//   is explicit about not adding one in this PR. When that flag lands the
//   field can be added here using `LineItemProvisioningSchema.optional()` —
//   same shape as the orders side — and the rename done by #356 means that
//   single import already reads as domain-neutral.
//
// The tests below pin both invariants so a future PR can't quietly slip the
// pre-fix record shape back in via the wrong carrier.
describe("Quotes line-item input schemas (#356)", () => {
  it("CreateQuoteInputSchema does not accept a `lineItems` field (post-#354 v2 POST body)", () => {
    const valid = { clientId: uuid };
    expect(CreateQuoteInputSchema.parse(valid)).toEqual(valid);
    // zod is permissive by default — `lineItems` is just stripped, not
    // rejected. Pin that it doesn't survive parsing, so a future caller
    // can't accidentally rely on it making it through to the wire.
    const parsed = CreateQuoteInputSchema.parse({
      clientId: uuid,
      lineItems: [
        { productId: uuid2, quantity: 1, provisioningDetails: [{ key: "k", values: ["v"] }] },
      ],
    } as unknown as { clientId: string });
    expect(parsed).not.toHaveProperty("lineItems");
  });

  it("UpdateQuoteInputSchema does not accept a `lineItems` field (post-#354 v2 PUT body)", () => {
    const valid = { status: "sent" as const };
    expect(UpdateQuoteInputSchema.parse(valid)).toEqual(valid);
    const parsed = UpdateQuoteInputSchema.parse({
      status: "sent",
      lineItems: [
        { productId: uuid2, quantity: 1, provisioningDetails: [{ key: "k", values: ["v"] }] },
      ],
    } as unknown as { status: "sent" });
    expect(parsed).not.toHaveProperty("lineItems");
  });

  // The current `AddQuoteLineItemInputSchema` (#312) intentionally omits
  // `provisioningDetails`. If a future PR adds it, this test will start
  // failing — at which point the new field MUST be wired to
  // `LineItemProvisioningSchema.optional()` so the spec-shape parity with
  // orders is preserved from day one. Update the test to mirror the orders
  // assertions in that PR.
  it("AddQuoteLineItemInputSchema does not yet surface `provisioningDetails` (canary for the future flag)", () => {
    const validBase = {
      productId: uuid2,
      quantity: 1,
      effectiveDate: "2026-05-11T00:00:00Z",
      price: 9.99,
    };
    const parsed = AddQuoteLineItemInputSchema.parse({
      ...validBase,
      provisioningDetails: [{ key: "domain", values: ["contoso.com"] }],
    } as unknown as typeof validBase);
    expect(parsed).not.toHaveProperty("provisioningDetails");

    // If/when `provisioningDetails` lands on this schema, the record shape
    // (the pre-#332 bug) must never be accepted. Pre-pin the regression
    // guard using `LineItemProvisioningSchema` directly so the contract is
    // documented even though the carrier field doesn't exist yet.
    expect(() =>
      LineItemProvisioningSchema.parse({ domain: "contoso.com" }),
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

  it("accepts the legacy `createdDate` wire shape and projects to canonical (#385)", () => {
    const parsed = SubscriptionSchema.parse(valid);
    expect(parsed.createdAt).toBe(valid.createdDate);
    expect(parsed).not.toHaveProperty("createdDate");
  });

  it("accepts the canonical `createdAt` wire shape (#385)", () => {
    const canonical = { ...valid, createdDate: undefined, createdAt: "2023-12-15T00:00:00Z" };
    const parsed = SubscriptionSchema.parse(canonical);
    expect(parsed.createdAt).toBe("2023-12-15T00:00:00Z");
    expect(parsed).not.toHaveProperty("createdDate");
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
    // The schema accepts legacy `createdDate` on the wire and projects it
    // onto canonical `createdAt`; `createdDate` is dropped from the parsed
    // shape.
    const { createdDate: _legacy, ...rest } = minimal;
    void _legacy;
    expect(SubscriptionSchema.parse(minimal)).toEqual({ ...rest, createdAt: "2024-01-01" });
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
    // Required on the v2 `QuoteResponse` and on `PUT /v2/quotes/{id}` —
    // both fields must round-trip through the read shape so the fetch-then-
    // merge update path (#313) can preserve them on writes.
    introMessage: "Sample intro.",
    termsAndDisclaimers: "Sample terms.",
    lineItems: [
      { productId: uuid, quantity: 10, billingTerm: "Annual", unitPrice: 22.5, subtotal: 225.0 },
    ],
  };

  it("accepts the legacy `createdOn` / `expiresOn` wire shape and projects to canonical (#385)", () => {
    const parsed = QuoteSchema.parse(valid);
    expect(parsed.createdAt).toBe(valid.createdOn);
    expect(parsed.expiresAt).toBe(valid.expiresOn);
    expect(parsed).not.toHaveProperty("createdOn");
    expect(parsed).not.toHaveProperty("expiresOn");
  });

  it("accepts the canonical `createdAt` / `expiresAt` wire shape (#385)", () => {
    const canonical = {
      ...valid,
      createdOn: undefined,
      expiresOn: undefined,
      createdAt: "2024-03-01",
      expiresAt: "2024-04-01",
    };
    const parsed = QuoteSchema.parse(canonical);
    expect(parsed.createdAt).toBe("2024-03-01");
    expect(parsed.expiresAt).toBe("2024-04-01");
    expect(parsed).not.toHaveProperty("createdOn");
    expect(parsed).not.toHaveProperty("expiresOn");
  });

  it("validates without lineItems", () => {
    // Strip lineItems via destructure; rest-sibling idiom.
    const { lineItems, ...rest } = valid;
    const parsed = QuoteSchema.parse(rest);
    expect(parsed.createdAt).toBe(rest.createdOn);
  });

  it("rejects missing status", () => {
    expect(() =>
      QuoteSchema.parse({
        id: uuid,
        companyId: uuid2,
        createdOn: "2024-03-01",
        introMessage: "x",
        termsAndDisclaimers: "y",
      }),
    ).toThrow();
  });

  it("rejects missing introMessage / termsAndDisclaimers (v2 required)", () => {
    // #313: the v2 spec marks these as required on the GET response; the
    // schema must enforce that so fetch-then-merge in `update` / `setStatus`
    // never sees an `undefined` for them.
    const { introMessage: _im, ...withoutIntro } = valid;
    void _im;
    expect(() => QuoteSchema.parse(withoutIntro)).toThrow();
    const { termsAndDisclaimers: _td, ...withoutTerms } = valid;
    void _td;
    expect(() => QuoteSchema.parse(withoutTerms)).toThrow();
  });

  // Server-side totals — surfaced from the v2 wire as `QuoteResponse.totals`
  // (an `InvoiceTotals` object splitting one-time `initial*` vs subscription
  // `recurring*` buckets, each carrying cost / profit / total amounts with
  // currency). Spec marks the field required; we keep the Zod field optional
  // for defensive parsing against API drift — the render layer handles the
  // absent case.
  it("parses a quote with server-side totals (initial + recurring)", () => {
    const withTotals = {
      ...valid,
      totals: {
        initialCost: { amount: 400, currency: "USD" },
        initialProfit: { amount: 100, currency: "USD" },
        initialTotal: { amount: 500, currency: "USD" },
        recurringCost: { amount: 176, currency: "USD" },
        recurringProfit: { amount: 44, currency: "USD" },
        recurringTotal: { amount: 220, currency: "USD" },
      },
    };
    const parsed = QuoteSchema.parse(withTotals);
    expect(parsed.totals?.initialTotal.amount).toBe(500);
    expect(parsed.totals?.initialTotal.currency).toBe("USD");
    expect(parsed.totals?.recurringTotal.amount).toBe(220);
  });

  it("parses without `totals` (optional — defensive against API drift)", () => {
    // Spec marks totals required, but a partial or older API response
    // shouldn't fail the whole quote parse. Schema accepts the absence;
    // render falls back to the locally-summed line subtotals.
    const parsed = QuoteSchema.parse(valid);
    expect(parsed.totals).toBeUndefined();
  });

  it("rejects malformed AmountCurrency inside totals (e.g. missing currency)", () => {
    const malformed = {
      ...valid,
      totals: {
        initialCost: { amount: 400 }, // missing currency
        initialProfit: { amount: 100, currency: "USD" },
        initialTotal: { amount: 500, currency: "USD" },
        recurringCost: { amount: 176, currency: "USD" },
        recurringProfit: { amount: 44, currency: "USD" },
        recurringTotal: { amount: 220, currency: "USD" },
      },
    };
    expect(() => QuoteSchema.parse(malformed)).toThrow();
  });

  it("accepts a quote-line-item with server-side per-line totals", () => {
    const withLineTotals = {
      ...valid,
      lineItems: [
        {
          productId: uuid,
          quantity: 10,
          billingTerm: "Annual",
          unitPrice: 22.5,
          subtotal: 225,
          totals: {
            initialCost: { amount: 0, currency: "USD" },
            initialProfit: { amount: 0, currency: "USD" },
            initialTotal: { amount: 0, currency: "USD" },
            recurringCost: { amount: 180, currency: "USD" },
            recurringProfit: { amount: 45, currency: "USD" },
            recurringTotal: { amount: 225, currency: "USD" },
          },
        },
      ],
    };
    const parsed = QuoteSchema.parse(withLineTotals);
    expect(parsed.lineItems?.[0].totals?.recurringTotal.amount).toBe(225);
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

  it("accepts the legacy `createdDate` wire shape and projects to canonical (#385)", () => {
    const parsed = WebhookSchema.parse(valid);
    expect(parsed.createdAt).toBe(valid.createdDate);
    expect(parsed).not.toHaveProperty("createdDate");
  });

  it("accepts the canonical `createdAt` wire shape (#385) and leaves updatedAt as-is (already canonical)", () => {
    const canonical = {
      id: uuid,
      url: "https://example.com/webhook",
      topics: ["subscription.created"],
      status: "Active",
      createdAt: "2024-03-01",
      updatedAt: "2024-04-01",
    };
    const parsed = WebhookSchema.parse(canonical);
    expect(parsed.createdAt).toBe("2024-03-01");
    expect(parsed.updatedAt).toBe("2024-04-01");
    expect(parsed).not.toHaveProperty("createdDate");
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
    // #385 — legacy `createdDate` wire shape is projected to canonical
    // `createdAt` and the legacy alias is dropped.
    expect(schema.parse(data)).toEqual({
      ...data,
      content: data.content.map((s) => {
        const { createdDate: _legacy, ...rest } = s;
        return { ...rest, createdAt: "2024-01-01" };
      }),
    });
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
  // day" — inline review comment. Surfaced from a prior platform incident;
  // partners must never see it.
  "originalSubscriptionId",
  // Internal subscription hierarchy reference. Reveals how Pax8 structures
  // subscription relationships internally; out of scope for partner-facing
  // surfaces. Hidden per the field-tier audit.
  "parentSubscriptionId",
  // Cross-vendor subscription mapping. Available on Microsoft via UPS-1751
  // but the CLI deliberately omits it; the domain-review reviewer approved
  // the choice.
  "vendorSubscriptionId",
  // Pax8's cost basis from the vendor. Tier 1 (Revenue/Competitive) —
  // direct margin disclosure.
  "partnerCost",
  // Pax8's wholesale rate from the vendor. Tier 1 — same concern as
  // partnerCost. The partner sees their own buy rate (price /
  // partnerBuyRate); they must never see what Pax8 pays the vendor.
  "wholesaleBuyRate",
  // Invoice-level cost basis. One of the fields the partner-safe invoice
  // summary endpoint deliberately omits to avoid wholesale cost leakage
  // (per Finance Services PRD).
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
        // ZodEffects (z.preprocess / z.transform / z.refine) exposes its
        // wrapped schema as `schema` rather than `innerType`. Added in #385
        // when several `*Schema` exports were wrapped in `z.preprocess()` to
        // canonicalize wire-shape timestamp field aliases.
        schema?: unknown;
      };
    }
  )._def;
  if (!def) return;
  if (def.innerType) {
    yield* walkObjectShapes(def.innerType, path, visited);
  }
  if (def.schema) {
    // ZodEffects wrapper — descend into the wrapped schema at the same path.
    yield* walkObjectShapes(def.schema, path, visited);
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
