// MockPax8Client — drop-in replacement for the real API client in demo mode.
// Returns demo data with simulated pagination, latency, and filtering.

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
  webhookTopics,
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
  const ms = 50 + Math.floor(Math.random() * 150); // 50–200ms
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

function notFound(resource: string, id: string): Error {
  const err = new Error(`${resource} not found: ${id}`);
  (err as any).statusCode = 404;
  return err;
}

// ─── Resource helpers ────────────────────────────────────────────────────────

class CompaniesResource {
  async list(
    params?: ListParams & { filter?: string }
  ): Promise<PaginatedResponse<Company>> {
    await randomDelay();
    let filtered = companies;
    if (params?.filter) {
      const q = params.filter.toLowerCase();
      filtered = companies.filter((c) => c.name.toLowerCase().includes(q));
    }
    return paginate(filtered, params);
  }

  async get(id: string): Promise<Company> {
    await randomDelay();
    const company = companies.find((c) => c.id === id);
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
        stateOrProvince: "",
        postalCode: "",
        country: "US",
      },
      phone: data.phone ?? "",
      website: data.website ?? "",
      status: "Active",
      billOnBehalfOfEnabled: false,
      selfServiceAllowed: false,
      orderApprovalRequired: false,
      createdDate: new Date().toISOString().split("T")[0],
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
    params?: ListParams & { companyId?: string }
  ): Promise<PaginatedResponse<Subscription>> {
    await randomDelay();
    let filtered = subscriptions;
    if (params?.companyId) {
      filtered = subscriptions.filter((s) => s.companyId === params.companyId);
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
    params?: ListParams & { vendorName?: string }
  ): Promise<PaginatedResponse<Product>> {
    await randomDelay();
    let filtered = products;
    if (params?.vendorName) {
      const v = params.vendorName.toLowerCase();
      filtered = products.filter((p) =>
        p.vendorName.toLowerCase().includes(v)
      );
    }
    return paginate(filtered, params);
  }

  async get(id: string): Promise<Product> {
    await randomDelay();
    const product = products.find((p) => p.id === id);
    if (!product) throw notFound("Product", id);
    return product;
  }

  async getPricing(id: string): Promise<Product["pricing"]> {
    await randomDelay();
    const product = products.find((p) => p.id === id);
    if (!product) throw notFound("Product", id);
    return product.pricing;
  }

  async getProvisioningDetails(
    id: string
  ): Promise<{ requiresDomain: boolean; requiresTenant: boolean; fields: string[] }> {
    await randomDelay();
    const product = products.find((p) => p.id === id);
    if (!product) throw notFound("Product", id);
    return {
      requiresDomain: product.vendorName === "Microsoft",
      requiresTenant: product.vendorName === "Microsoft",
      fields: product.vendorName === "Microsoft" ? ["domain", "tenantId"] : [],
    };
  }

  async getDependencies(id: string): Promise<{ dependencies: string[] }> {
    await randomDelay();
    return { dependencies: [] };
  }
}

class InvoicesResource {
  async list(
    params?: ListParams & { companyId?: string; month?: string }
  ): Promise<PaginatedResponse<Invoice>> {
    await randomDelay();
    let filtered = invoices;
    if (params?.companyId) {
      filtered = filtered.filter((i) => i.companyId === params.companyId);
    }
    if (params?.month) {
      filtered = filtered.filter((i) => i.invoiceDate.startsWith(params.month!));
    }
    return paginate(filtered, params);
  }

  async get(id: string): Promise<Invoice> {
    await randomDelay();
    const invoice = invoices.find((i) => i.id === id);
    if (!invoice) throw notFound("Invoice", id);
    return invoice;
  }

  async listItems(
    params?: ListParams & { invoiceId?: string; companyId?: string; month?: string }
  ): Promise<PaginatedResponse<InvoiceItem>> {
    await randomDelay();
    let filtered = invoiceItems;
    if (params?.invoiceId) {
      filtered = filtered.filter((ii) => ii.invoiceId === params.invoiceId);
    }
    if (params?.companyId) {
      filtered = filtered.filter((ii) => ii.companyId === params.companyId);
    }
    if (params?.month) {
      filtered = filtered.filter((ii) =>
        ii.billingPeriodStart.startsWith(params.month!)
      );
    }
    return paginate(filtered, params);
  }

  async listDraftItems(
    params?: ListParams
  ): Promise<PaginatedResponse<InvoiceItem>> {
    await randomDelay();
    // In demo mode, return empty — no draft items
    return paginate([], params);
  }
}

class OrdersResource {
  async list(
    params?: ListParams & { companyId?: string }
  ): Promise<PaginatedResponse<Order>> {
    await randomDelay();
    let filtered = orders;
    if (params?.companyId) {
      filtered = orders.filter((o) => o.companyId === params.companyId);
    }
    return paginate(filtered, params);
  }

  async get(id: string): Promise<Order> {
    await randomDelay();
    const order = orders.find((o) => o.id === id);
    if (!order) throw notFound("Order", id);
    return order;
  }

  async create(data: Partial<Order>): Promise<Order> {
    await randomDelay();
    const newOrder: Order = {
      id: `ord-demo-${Date.now()}`,
      companyId: data.companyId ?? "",
      companyName: data.companyName ?? "Unknown",
      orderedBy: "Demo User",
      orderedByEmail: "demo@example.com",
      createdDate: new Date().toISOString().split("T")[0],
      lineItems: data.lineItems ?? [],
      status: "Processing",
    };
    return newOrder;
  }
}

class ContactsResource {
  async list(
    params?: ListParams & { companyId?: string }
  ): Promise<PaginatedResponse<Contact>> {
    await randomDelay();
    let filtered = contacts;
    if (params?.companyId) {
      filtered = contacts.filter((c) => c.companyId === params.companyId);
    }
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
      phone: data.phone ?? "",
      type: data.type ?? "Admin",
      isPrimary: data.isPrimary ?? false,
      createdDate: new Date().toISOString().split("T")[0],
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
    params?: ListParams & { companyId?: string; month?: string }
  ): Promise<PaginatedResponse<UsageSummary>> {
    await randomDelay();
    let filtered = usageSummaries;
    if (params?.companyId) {
      filtered = filtered.filter((u) => u.companyId === params.companyId);
    }
    if (params?.month) {
      filtered = filtered.filter((u) => u.usageDate.startsWith(params.month!));
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
    params?: ListParams & { usageSummaryId?: string }
  ): Promise<PaginatedResponse<UsageLine>> {
    await randomDelay();
    let filtered = usageLines;
    if (params?.usageSummaryId) {
      filtered = usageLines.filter(
        (l) => l.usageSummaryId === params.usageSummaryId
      );
    }
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
      companyName: data.companyName ?? "Unknown",
      createdDate: new Date().toISOString().split("T")[0],
      expirationDate: data.expirationDate ?? "",
      status: "Draft",
      total: data.total ?? 0,
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

class WebhooksResource {
  async list(params?: ListParams): Promise<PaginatedResponse<Webhook>> {
    await randomDelay();
    return paginate(webhooks, params);
  }

  async get(id: string): Promise<Webhook> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    return wh;
  }

  async create(data: Partial<Webhook>): Promise<Webhook> {
    await randomDelay();
    const newWh: Webhook = {
      id: `wh-demo-${Date.now()}`,
      url: data.url ?? "",
      status: "Active",
      topics: data.topics ?? [],
      createdDate: new Date().toISOString().split("T")[0],
      lastTriggeredDate: null,
      secret: `whsec_demo_${Date.now()}`,
    };
    return newWh;
  }

  async update(id: string, data: Partial<Webhook>): Promise<Webhook> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    return { ...wh, ...data, id: wh.id };
  }

  async updateStatus(
    id: string,
    status: "Active" | "Inactive"
  ): Promise<Webhook> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    return { ...wh, status };
  }

  async addTopics(id: string, topics: string[]): Promise<Webhook> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    const merged = [...new Set([...wh.topics, ...topics])];
    return { ...wh, topics: merged };
  }

  async replaceTopics(id: string, topics: string[]): Promise<Webhook> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    return { ...wh, topics };
  }

  async removeTopics(id: string, topics: string[]): Promise<Webhook> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    const remaining = wh.topics.filter((t) => !topics.includes(t));
    return { ...wh, topics: remaining };
  }

  async delete(id: string): Promise<void> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
  }

  async test(
    id: string,
    topic?: string
  ): Promise<{ success: boolean; statusCode: number; responseTime: number }> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    return { success: wh.status === "Active", statusCode: wh.status === "Active" ? 200 : 502, responseTime: 123 };
  }

  async logs(
    params?: ListParams & { webhookId?: string }
  ): Promise<PaginatedResponse<WebhookLog>> {
    await randomDelay();
    let filtered = webhookLogs;
    if (params?.webhookId) {
      filtered = webhookLogs.filter((l) => l.webhookId === params.webhookId);
    }
    return paginate(filtered, params);
  }

  async retry(logId: string): Promise<WebhookLog> {
    await randomDelay();
    const log = webhookLogs.find((l) => l.id === logId);
    if (!log) throw notFound("WebhookLog", logId);
    return { ...log, status: "Success", statusCode: 200 };
  }

  async listTopics(): Promise<string[]> {
    await randomDelay();
    return webhookTopics;
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
