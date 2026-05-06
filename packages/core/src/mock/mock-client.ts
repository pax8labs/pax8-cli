// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

// MockPax8Client — drop-in replacement for the real API client in demo mode.
// Returns demo data with simulated pagination, latency, and filtering.

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { homedir as nodeHomedir } from "node:os";
import {
  companies,
  subscriptions,
  products,
  invoices,
  invoiceItems,
  orders,
  contacts,
  usageSummaries,
  usageLines,
  quotes,
  webhooks,
  webhookLogs,
  type Company,
  type Subscription,
  type Product,
  type Invoice,
  type InvoiceItem,
  type Order,
  type Contact,
  type UsageSummary,
  type UsageLine,
  type Quote,
  type Webhook,
  type WebhookLog,
} from "./demo-data.js";
import { NotFoundError } from "../api/errors.js";
import type {
  CreateOrderInput,
  ProductPricing as ProductPricingPlans,
  ProvisioningDetail as ProvisioningDetailType,
  ProductDependency as ProductDependencyType,
} from "../api/types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  content: T[];
  page: {
    size: number;
    totalElements: number;
    totalPages: number;
    number: number;
  };
}

export interface ListParams {
  page?: number;
  size?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomDelay(): Promise<void> {
  // Skip delays entirely when running in test/CI or when PAX8_FAST_MOCK is set.
  // In demo mode, use a short delay (5–20ms) so spinners still feel real
  // without making multi-call commands painfully slow.
  if (process.env.PAX8_TEST || process.env.CI || process.env.PAX8_FAST_MOCK) {
    return Promise.resolve();
  }
  const ms = 5 + Math.floor(Math.random() * 15); // 5–20ms
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function paginate<T>(
  items: T[],
  params?: ListParams
): PaginatedResponse<T> {
  const page = params?.page ?? 0;
  const size = params?.size ?? 10;
  const start = page * size;
  const content = items.slice(start, start + size);
  return {
    content,
    page: {
      size,
      totalElements: items.length,
      totalPages: Math.ceil(items.length / size),
      number: page,
    },
  };
}

function notFound(resource: string, id: string): NotFoundError {
  return new NotFoundError(resource, id);
}

// ─── Resource helpers ────────────────────────────────────────────────────────

class CompaniesResource {
  async list(
    params?: ListParams & { filter?: string; status?: string }
  ): Promise<PaginatedResponse<Company>> {
    await randomDelay();
    let filtered = companies;
    if (params?.filter) {
      const q = params.filter.toLowerCase();
      filtered = filtered.filter((c) => c.name.toLowerCase().includes(q));
    }
    if (params?.status) {
      const s = params.status.toLowerCase();
      filtered = filtered.filter((c) => c.status.toLowerCase() === s);
    }
    return paginate(filtered, params);
  }

  async get(id: string): Promise<Company> {
    await randomDelay();
    const company = companies.find((c) => c.id === id)
      ?? companies.find((c) => c.name.toLowerCase() === id.toLowerCase())
      ?? companies.find((c) => c.id.startsWith(id) || c.name.toLowerCase().includes(id.toLowerCase()));
    if (!company) throw notFound("Company", id);
    return company;
  }

  async create(data: Partial<Company>): Promise<Company> {
    await randomDelay();
    const newCompany: Company = {
      id: `demo-new-${Date.now()}`,
      name: data.name ?? "New Company",
      address: data.address ?? {
        street: "",
        city: "",
        state: "",
        zip: "",
        country: "US",
      },
      phone: data.phone ?? "",
      website: data.website ?? "",
      status: "Active",
      billOnBehalfOfEnabled: false,
      selfServiceAllowed: false,
      orderApprovalRequired: false,
      created: new Date().toISOString().split("T")[0],
    };
    return newCompany;
  }

  async update(id: string, data: Partial<Company>): Promise<Company> {
    await randomDelay();
    const company = companies.find((c) => c.id === id);
    if (!company) throw notFound("Company", id);
    return { ...company, ...data, id: company.id };
  }
}

class SubscriptionsResource {
  async list(
    params?: ListParams & { companyId?: string; status?: string }
  ): Promise<PaginatedResponse<Subscription>> {
    await randomDelay();
    let filtered = subscriptions;
    if (params?.companyId) {
      filtered = filtered.filter((s) => s.companyId === params.companyId);
    }
    if (params?.status) {
      const s = params.status.toLowerCase();
      filtered = filtered.filter((sub) => sub.status.toLowerCase() === s);
    }
    return paginate(filtered, params);
  }

  async get(id: string): Promise<Subscription> {
    await randomDelay();
    const sub = subscriptions.find((s) => s.id === id);
    if (!sub) throw notFound("Subscription", id);
    return sub;
  }

  async getHistory(
    id: string
  ): Promise<{ changes: { date: string; field: string; oldValue: string; newValue: string }[] }> {
    await randomDelay();
    const sub = subscriptions.find((s) => s.id === id);
    if (!sub) throw notFound("Subscription", id);
    return {
      changes: [
        {
          date: sub.createdDate,
          field: "status",
          oldValue: "New",
          newValue: sub.status,
        },
        {
          date: sub.startDate,
          field: "quantity",
          oldValue: "0",
          newValue: String(sub.quantity),
        },
      ],
    };
  }

  async update(
    id: string,
    data: Partial<Subscription>
  ): Promise<Subscription> {
    await randomDelay();
    const sub = subscriptions.find((s) => s.id === id);
    if (!sub) throw notFound("Subscription", id);
    return { ...sub, ...data, id: sub.id };
  }

  async delete(id: string): Promise<void> {
    await randomDelay();
    const sub = subscriptions.find((s) => s.id === id);
    if (!sub) throw notFound("Subscription", id);
  }
}

class ProductsResource {
  async list(
    params?: ListParams & { vendorName?: string; search?: string }
  ): Promise<PaginatedResponse<Product>> {
    await randomDelay();
    let filtered = products;
    if (params?.vendorName) {
      const v = params.vendorName.toLowerCase();
      filtered = filtered.filter((p) =>
        p.vendorName.toLowerCase().includes(v)
      );
    }
    if (params?.search) {
      // Real Pax8 API treats the entire `search` value as a single keyword:
      // substring-matches it against the product name, but multi-word
      // values silently return zero. Mirror that here so tests catch the
      // multi-word footgun rather than masking it with looser matching.
      const s = params.search.toLowerCase();
      const isSingleWord = !/\s/.test(s);
      filtered = isSingleWord
        ? filtered.filter((p) => p.name.toLowerCase().includes(s))
        : [];
    }
    return paginate(filtered, params);
  }

  /**
   * Search products by free-text query. Mirrors `ProductsApi.search()`: picks
   * the longest token to pass to the upstream `search` param so multi-word
   * queries don't silently return empty.
   */
  async search(
    query: string,
    params?: ListParams & { vendorName?: string }
  ): Promise<PaginatedResponse<Product>> {
    const tokens = query.split(/\s+/).filter(Boolean);
    const apiKeyword = tokens.reduce(
      (best, t) => (t.length >= best.length ? t : best),
      "",
    );
    return this.list({
      ...params,
      search: apiKeyword || undefined,
    });
  }

  async get(id: string): Promise<Product> {
    await randomDelay();
    const product = products.find((p) => p.id === id)
      ?? products.find((p) => p.name.toLowerCase() === id.toLowerCase())
      ?? products.find((p) => p.id.startsWith(id) || p.name.toLowerCase().includes(id.toLowerCase()));
    if (!product) throw notFound("Product", id);
    return product;
  }

  async getPricing(id: string): Promise<ProductPricingPlans> {
    await randomDelay();
    const product = products.find((p) => p.id === id);
    if (!product) throw notFound("Product", id);
    // Adapt the compact mock seed shape to the public `ProductPricingPlan[]`
    // shape that `ProductsApi.getPricing()` returns, so consumers can treat
    // the result identically across real and demo modes.
    return product.pricing.map((p) => ({
      productId: product.id,
      productName: product.name,
      billingTerm: p.billingTerm,
      commitmentTerm: p.commitmentTerm,
      unitOfMeasurement: product.unitOfMeasurement,
      rates: [
        {
          partnerBuyRate: p.partnerBuyPrice,
          suggestedRetailPrice: p.suggestedRetailPrice,
        },
      ],
    }));
  }

  async getProvisioningDetails(
    id: string
  ): Promise<ProvisioningDetailType> {
    await randomDelay();
    const product = products.find((p) => p.id === id);
    if (!product) throw notFound("Product", id);
    const isMicrosoft = product.vendorName === "Microsoft";
    return {
      productId: product.id,
      vendorPrerequisites: isMicrosoft
        ? "Customer must have a Microsoft tenant and a verified domain."
        : undefined,
      fields: isMicrosoft
        ? [
            { name: "domain", label: "Tenant Domain", type: "string", required: true },
            { name: "tenantId", label: "Microsoft Tenant ID", type: "string", required: true },
          ]
        : [],
    };
  }

  async getDependencies(_id: string): Promise<ProductDependencyType[]> {
    await randomDelay();
    return [];
  }
}

class InvoicesResource {
  async list(
    params?: ListParams & { companyId?: string; month?: string; status?: string }
  ): Promise<PaginatedResponse<Invoice>> {
    await randomDelay();
    let filtered = invoices;
    if (params?.companyId) {
      filtered = filtered.filter((i) => i.companyId === params.companyId);
    }
    if (params?.month) {
      filtered = filtered.filter((i) => i.invoiceDate.startsWith(params.month!));
    }
    if (params?.status) {
      const s = params.status.toLowerCase();
      filtered = filtered.filter((i) => i.status.toLowerCase() === s);
    }
    return paginate(filtered, params);
  }

  async get(id: string): Promise<Invoice> {
    await randomDelay();
    const invoice = invoices.find((i) => i.id === id);
    if (!invoice) throw notFound("Invoice", id);
    return invoice;
  }

  // Overloaded to support both real API style: listItems(id, params)
  // and legacy mock style: listItems({ invoiceId, ... })
  async listItems(
    idOrParams?: string | (ListParams & { invoiceId?: string; companyId?: string; month?: string }),
    params?: ListParams & { companyId?: string; month?: string },
  ): Promise<PaginatedResponse<InvoiceItem>> {
    await randomDelay();
    let filtered = invoiceItems;
    let paginationParams: ListParams | undefined;

    if (typeof idOrParams === "string") {
      // Real API style: listItems(invoiceId, { size, ... })
      filtered = filtered.filter((ii) => ii.invoiceId === idOrParams);
      if (params?.companyId) {
        filtered = filtered.filter((ii) => ii.companyId === params.companyId);
      }
      if (params?.month) {
        filtered = filtered.filter((ii) =>
          ii.billingPeriodStart.startsWith(params.month!)
        );
      }
      paginationParams = params;
    } else if (idOrParams) {
      // Legacy mock style: listItems({ invoiceId, companyId, month, ... })
      if (idOrParams.invoiceId) {
        filtered = filtered.filter((ii) => ii.invoiceId === idOrParams.invoiceId);
      }
      if (idOrParams.companyId) {
        filtered = filtered.filter((ii) => ii.companyId === idOrParams.companyId);
      }
      if (idOrParams.month) {
        filtered = filtered.filter((ii) =>
          ii.billingPeriodStart.startsWith(idOrParams.month!)
        );
      }
      paginationParams = idOrParams;
    }
    return paginate(filtered, paginationParams);
  }

  async listDraftItems(
    params?: ListParams
  ): Promise<PaginatedResponse<InvoiceItem>> {
    await randomDelay();
    // In demo mode, return empty — no draft items
    return paginate([], params);
  }
}

const DEMO_ORDERS_FILE = nodePath.join(nodeHomedir(), ".pax8", "demo-orders.json");

class OrdersResource {
  private createdOrders: Order[] | null = null;

  private loadCreated(): Order[] {
    if (this.createdOrders !== null) return this.createdOrders;
    try {
      this.createdOrders = JSON.parse(nodeFs.readFileSync(DEMO_ORDERS_FILE, "utf-8"));
    } catch {
      this.createdOrders = [];
    }
    return this.createdOrders!;
  }

  private saveCreated(): void {
    try {
      nodeFs.mkdirSync(nodePath.dirname(DEMO_ORDERS_FILE), { recursive: true });
      nodeFs.writeFileSync(DEMO_ORDERS_FILE, JSON.stringify(this.createdOrders));
    } catch { /* best effort */ }
  }

  async list(
    params?: ListParams & { companyId?: string; status?: string }
  ): Promise<PaginatedResponse<Order>> {
    await randomDelay();
    let filtered = [...orders, ...this.loadCreated()];
    if (params?.companyId) {
      filtered = filtered.filter((o) => o.companyId === params.companyId);
    }
    if (params?.status) {
      const s = params.status.toLowerCase();
      filtered = filtered.filter((o) => o.status.toLowerCase() === s);
    }
    return paginate(filtered, params);
  }

  async get(id: string): Promise<Order> {
    await randomDelay();
    const allOrders = [...orders, ...this.loadCreated()];
    const order = allOrders.find((o) => o.id === id);
    if (!order) throw notFound("Order", id);
    return order;
  }

  async create(data: CreateOrderInput): Promise<Order> {
    await randomDelay();
    // Resolve company name from demo data
    const company = companies.find((c) => c.id === data.companyId);
    const newOrder: Order = {
      id: `ord-demo-${Date.now()}`,
      companyId: data.companyId,
      companyName: company?.name ?? "Unknown",
      orderedBy: "Demo User",
      orderedByEmail: "demo@example.com",
      createdDate: new Date().toISOString().split("T")[0],
      lineItems: data.lineItems.map((li) => ({
        productId: li.productId,
        productName: products.find((p) => p.id === li.productId)?.name ?? "Unknown",
        quantity: li.quantity,
        billingTerm: (li.billingTerm ?? "Monthly") as "Monthly" | "Annual",
      })),
      status: "Processing",
    };
    this.loadCreated().push(newOrder);
    this.saveCreated();
    return newOrder;
  }
}

class ContactsResource {
  // Mirrors ContactsApi.list — companyId is the first positional argument.
  async list(
    companyId: string,
    params?: ListParams,
  ): Promise<PaginatedResponse<Contact>> {
    await randomDelay();
    const filtered = contacts.filter((c) => c.companyId === companyId);
    return paginate(filtered, params);
  }

  async get(id: string): Promise<Contact> {
    await randomDelay();
    const contact = contacts.find((c) => c.id === id);
    if (!contact) throw notFound("Contact", id);
    return contact;
  }

  async create(data: Partial<Contact>): Promise<Contact> {
    await randomDelay();
    const newContact: Contact = {
      id: `contact-demo-${Date.now()}`,
      companyId: data.companyId ?? "",
      firstName: data.firstName ?? "",
      lastName: data.lastName ?? "",
      email: data.email ?? "",
      ...(data.phone ? { phone: data.phone } : {}),
      types: data.types && data.types.length > 0 ? data.types : ["Admin"],
    };
    return newContact;
  }

  async update(id: string, data: Partial<Contact>): Promise<Contact> {
    await randomDelay();
    const contact = contacts.find((c) => c.id === id);
    if (!contact) throw notFound("Contact", id);
    return { ...contact, ...data, id: contact.id };
  }

  async delete(id: string): Promise<void> {
    await randomDelay();
    const contact = contacts.find((c) => c.id === id);
    if (!contact) throw notFound("Contact", id);
  }
}

class UsageResource {
  async listSummaries(
    params?: ListParams & { companyId?: string; resourceGroup?: string }
  ): Promise<PaginatedResponse<UsageSummary>> {
    await randomDelay();
    let filtered = usageSummaries;
    if (params?.companyId) {
      filtered = filtered.filter((u) => u.companyId === params.companyId);
    }
    if (params?.resourceGroup) {
      filtered = filtered.filter((u) => u.resourceGroup === params.resourceGroup);
    }
    return paginate(filtered, params);
  }

  async getSummary(id: string): Promise<UsageSummary> {
    await randomDelay();
    const summary = usageSummaries.find((u) => u.id === id);
    if (!summary) throw notFound("UsageSummary", id);
    return summary;
  }

  async listLines(
    summaryId: string,
    params?: ListParams
  ): Promise<PaginatedResponse<UsageLine>> {
    await randomDelay();
    const filtered = usageLines.filter((l) => l.usageSummaryId === summaryId);
    return paginate(filtered, params);
  }
}

class QuotesResource {
  async list(
    params?: ListParams & { companyId?: string }
  ): Promise<PaginatedResponse<Quote>> {
    await randomDelay();
    let filtered = quotes;
    if (params?.companyId) {
      filtered = quotes.filter((q) => q.companyId === params.companyId);
    }
    return paginate(filtered, params);
  }

  async get(id: string): Promise<Quote> {
    await randomDelay();
    const quote = quotes.find((q) => q.id === id);
    if (!quote) throw notFound("Quote", id);
    return quote;
  }

  async create(data: Partial<Quote>): Promise<Quote> {
    await randomDelay();
    const newQuote: Quote = {
      id: `quote-demo-${Date.now()}`,
      companyId: data.companyId ?? "",
      createdDate: new Date().toISOString().split("T")[0],
      ...(data.expirationDate ? { expirationDate: data.expirationDate } : {}),
      status: "Draft",
      lineItems: data.lineItems ?? [],
    };
    return newQuote;
  }

  async update(id: string, data: Partial<Quote>): Promise<Quote> {
    await randomDelay();
    const quote = quotes.find((q) => q.id === id);
    if (!quote) throw notFound("Quote", id);
    return { ...quote, ...data, id: quote.id };
  }

  async delete(id: string): Promise<void> {
    await randomDelay();
    const quote = quotes.find((q) => q.id === id);
    if (!quote) throw notFound("Quote", id);
  }
}

// Mock surface mirrors the real @pax8/core WebhooksApi:
//   list()       → Webhook[]
//   create(data) → Webhook
//   get(id)      → Webhook
//   update(id, data)        → Webhook
//   updateStatus(id, status)→ Webhook
//   delete(id)   → void
//   test(id)     → unknown (returns a small structured payload here)
//   getLogs(id)  → WebhookLog[]
//   retryLog(id, logId) → unknown
class WebhooksResource {
  async list(): Promise<Webhook[]> {
    await randomDelay();
    return [...webhooks];
  }

  async get(id: string): Promise<Webhook> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    return wh;
  }

  async create(data: { url: string; topics: string[] }): Promise<Webhook> {
    await randomDelay();
    // Generate a deterministic-ish UUID-shaped id for demo mode.
    const newId = `99999999-aaaa-bbbb-cccc-${String(Date.now()).padStart(12, "0").slice(-12)}`;
    const newWh: Webhook = {
      id: newId,
      url: data.url,
      status: "Active",
      topics: data.topics,
      createdDate: new Date().toISOString().split("T")[0],
      secret: `whsec_demo_${Date.now()}`,
    };
    return newWh;
  }

  async update(
    id: string,
    data: { url?: string; topics?: string[]; status?: "Active" | "Disabled" }
  ): Promise<Webhook> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    return { ...wh, ...data, id: wh.id };
  }

  async updateStatus(
    id: string,
    status: "Active" | "Disabled"
  ): Promise<Webhook> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    return { ...wh, status };
  }

  async delete(id: string): Promise<void> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
  }

  async test(id: string): Promise<unknown> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    return {
      success: wh.status === "Active",
      responseCode: wh.status === "Active" ? 200 : 502,
      sentAt: new Date().toISOString(),
    };
  }

  async getLogs(id: string): Promise<WebhookLog[]> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    return webhookLogs.filter((l) => l.webhookId === id);
  }

  async retryLog(id: string, logId: string): Promise<unknown> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    const log = webhookLogs.find((l) => l.id === logId && l.webhookId === id);
    if (!log) throw notFound("WebhookLog", logId);
    return { ...log, responseCode: 200, responseBody: "OK" };
  }
}

// ─── MockPax8Client ──────────────────────────────────────────────────────────

export class MockPax8Client {
  readonly companies = new CompaniesResource();
  readonly subscriptions = new SubscriptionsResource();
  readonly products = new ProductsResource();
  readonly invoices = new InvoicesResource();
  readonly orders = new OrdersResource();
  readonly contacts = new ContactsResource();
  readonly usage = new UsageResource();
  readonly quotes = new QuotesResource();
  readonly webhooks = new WebhooksResource();
}
