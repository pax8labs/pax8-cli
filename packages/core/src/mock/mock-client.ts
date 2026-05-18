// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

// MockPax8Client — drop-in replacement for the real API client in demo mode.
// Returns demo data with simulated pagination, latency, and filtering.

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { getConfigDir } from "../config/loader.js";
import { safeWriteFileSync } from "../security/safe-write.js";
// Import entity arrays via the fixture selector (#484): defaults to the
// hand-curated small fixture; switches to the generated large fixture
// when `PAX8_DEMO_SCALE=large` is set. Types continue to come from
// `./demo-data.js` because they're canonical and shared by both fixtures.
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
  webhookTopicDefinitions,
} from "./fixture.js";
import type {
  Company,
  Subscription,
  Product,
  Invoice,
  InvoiceItem,
  Order,
  Contact,
  UsageSummary,
  UsageLine,
  Quote as DemoQuote,
  Webhook,
  WebhookLog,
  WebhookTopicDefinition,
} from "./demo-data.js";
import { ApiError, NotFoundError } from "../api/errors.js";
import {
  QuoteSchema,
  type CreateOrderInput,
  type ProductPricing as ProductPricingPlans,
  type ProvisioningDetail as ProvisioningDetailType,
  type ProductDependency as ProductDependencyType,
  type AddQuoteLineItemInput,
  type QuoteStatusTransition,
  type Quote,
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
    params?: ListParams & {
      status?: string;
      // Geography filters (#388) — spec-canonical names
      city?: string;
      country?: string;
      stateOrProvince?: string;
      postalCode?: string;
      // Capability filters (#388)
      selfServiceAllowed?: boolean;
      billOnBehalfOfEnabled?: boolean;
      orderApprovalRequired?: boolean;
      // Sort field (#388) — spec enum
      sort?: "name" | "city" | "country" | "stateOrProvince" | "postalCode";
    }
  ): Promise<PaginatedResponse<Company>> {
    await randomDelay();
    let filtered = companies;
    if (params?.status) {
      const s = params.status.toLowerCase();
      filtered = filtered.filter((c) => c.status.toLowerCase() === s);
    }
    if (params?.city) {
      const q = params.city.toLowerCase();
      filtered = filtered.filter((c) => c.address?.city?.toLowerCase() === q);
    }
    if (params?.country) {
      const q = params.country.toLowerCase();
      filtered = filtered.filter((c) => c.address?.country?.toLowerCase() === q);
    }
    if (params?.stateOrProvince) {
      const q = params.stateOrProvince.toLowerCase();
      filtered = filtered.filter(
        (c) => c.address?.stateOrProvince?.toLowerCase() === q,
      );
    }
    if (params?.postalCode) {
      filtered = filtered.filter((c) => c.address?.postalCode === params.postalCode);
    }
    if (typeof params?.selfServiceAllowed === "boolean") {
      filtered = filtered.filter(
        (c) => Boolean(c.selfServiceAllowed) === params.selfServiceAllowed,
      );
    }
    if (typeof params?.billOnBehalfOfEnabled === "boolean") {
      filtered = filtered.filter(
        (c) => Boolean(c.billOnBehalfOfEnabled) === params.billOnBehalfOfEnabled,
      );
    }
    if (typeof params?.orderApprovalRequired === "boolean") {
      filtered = filtered.filter(
        (c) => Boolean(c.orderApprovalRequired) === params.orderApprovalRequired,
      );
    }
    if (params?.sort) {
      // Spec sort key maps directly onto a field selector — stable sort,
      // ascending (the spec doesn't define direction; we default to natural).
      const key = params.sort;
      const getField = (c: Company): string => {
        if (key === "name") return c.name ?? "";
        if (key === "city") return c.address?.city ?? "";
        if (key === "country") return c.address?.country ?? "";
        if (key === "stateOrProvince") return c.address?.stateOrProvince ?? "";
        if (key === "postalCode") return c.address?.postalCode ?? "";
        return "";
      };
      filtered = [...filtered].sort((a, b) => getField(a).localeCompare(getField(b)));
    }
    const page = paginate(filtered, params);
    return page;
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
    // Mirror the spec's required-field contract: when no address is supplied
    // the mock leaves `address` undefined rather than fabricating an empty
    // object. The real `companies create` UX fail-fasts before reaching the
    // wire (see #329), but tests that call the mock directly with a partial
    // body should see the same shape they'd send.
    const newCompany: Company = {
      id: `demo-new-${Date.now()}`,
      name: data.name ?? "New Company",
      address: data.address,
      phone: data.phone ?? "",
      website: data.website ?? "",
      status: "Active",
      billOnBehalfOfEnabled: data.billOnBehalfOfEnabled ?? false,
      selfServiceAllowed: data.selfServiceAllowed ?? false,
      orderApprovalRequired: data.orderApprovalRequired ?? false,
      createdAt: new Date().toISOString().split("T")[0],
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
    const page = paginate(filtered, params);
    return page;
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
          date: sub.createdAt,
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

  async delete(id: string, _params?: { cancelDate?: string }): Promise<void> {
    await randomDelay();
    const sub = subscriptions.find((s) => s.id === id);
    if (!sub) throw notFound("Subscription", id);
    // Demo mode ignores `cancelDate`: scheduled cancellations don't materialize
    // a future state-change in the in-memory data set, but the param is accepted
    // so the CLI surface matches the real client signature.
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
  ): Promise<ProvisioningDetailType[]> {
    await randomDelay();
    const product = products.find((p) => p.id === id);
    if (!product) throw notFound("Product", id);
    if (product.vendorName === "Microsoft") {
      return [
        {
          key: "domain",
          label: "Tenant Domain",
          description: "Customer's verified Microsoft tenant domain (e.g. contoso.onmicrosoft.com).",
          valueType: "Input",
          possibleValues: null,
        },
        {
          key: "tenantId",
          label: "Microsoft Tenant ID",
          description: "GUID identifying the customer's Microsoft Entra tenant.",
          valueType: "Input",
          possibleValues: null,
        },
      ];
    }
    return [];
  }

  async getDependencies(_id: string): Promise<ProductDependencyType[]> {
    await randomDelay();
    return [];
  }
}

class InvoicesResource {
  async list(
    params?: ListParams & {
      companyId?: string;
      month?: string;
      invoiceDate?: string;
      status?: string;
      // #389 spec params
      invoiceDateRangeStart?: string;
      invoiceDateRangeEnd?: string;
      dueDate?: string;
      total?: number;
      balance?: number;
      carriedBalance?: number;
      sort?:
        | "invoiceDate"
        | "dueDate"
        | "status"
        | "partnerName"
        | "total"
        | "balance"
        | "carriedBalance";
    }
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
    // #389: spec-backed date-range + numeric / sort filters. Demo mode mirrors
    // the server-side semantics so subprocess tests can exercise the wire path.
    if (params?.invoiceDateRangeStart) {
      filtered = filtered.filter((i) => i.invoiceDate >= params.invoiceDateRangeStart!);
    }
    if (params?.invoiceDateRangeEnd) {
      filtered = filtered.filter((i) => i.invoiceDate <= params.invoiceDateRangeEnd!);
    }
    if (params?.dueDate) {
      filtered = filtered.filter((i) => i.dueDate === params.dueDate);
    }
    if (typeof params?.total === "number") {
      filtered = filtered.filter((i) => i.total === params.total);
    }
    if (typeof params?.balance === "number") {
      filtered = filtered.filter((i) => i.balance === params.balance);
    }
    if (typeof params?.carriedBalance === "number") {
      filtered = filtered.filter(
        (i) => (i as { carriedBalance?: number }).carriedBalance === params.carriedBalance,
      );
    }
    if (params?.sort) {
      const key = params.sort;
      const getField = (i: Invoice): string | number => {
        if (key === "invoiceDate") return i.invoiceDate ?? "";
        if (key === "dueDate") return i.dueDate ?? "";
        if (key === "status") return i.status ?? "";
        if (key === "partnerName") return (i as { partnerName?: string }).partnerName ?? "";
        if (key === "total") return i.total ?? 0;
        if (key === "balance") return i.balance ?? 0;
        if (key === "carriedBalance") return (i as { carriedBalance?: number }).carriedBalance ?? 0;
        return "";
      };
      filtered = [...filtered].sort((a, b) => {
        const av = getField(a);
        const bv = getField(b);
        if (typeof av === "number" && typeof bv === "number") return av - bv;
        return String(av).localeCompare(String(bv));
      });
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

// #458 / #475: resolve lazily each call so `PAX8_CONFIG_DIR` overrides set by
// vitest's per-test isolation (or by a developer between commands) are
// honored. A module-level constant captured at load time would freeze the
// path to whatever the env was at first import, which means writes leak
// into the contributor's real `~/.pax8/` whenever a downstream test clears
// or rebinds the variable.
function demoOrdersFile(): string {
  return nodePath.join(getConfigDir(), "demo-orders.json");
}

class OrdersResource {
  private createdOrders: Order[] | null = null;

  private loadCreated(): Order[] {
    if (this.createdOrders !== null) return this.createdOrders;
    try {
      this.createdOrders = JSON.parse(nodeFs.readFileSync(demoOrdersFile(), "utf-8"));
    } catch {
      this.createdOrders = [];
    }
    return this.createdOrders!;
  }

  private saveCreated(): void {
    try {
      const fp = demoOrdersFile();
      nodeFs.mkdirSync(nodePath.dirname(fp), { recursive: true });
      // #469: route through safeWriteFileSync so the demo-state file is
      // 0o600 + O_NOFOLLOW like the rest of the CLI's local writes.
      safeWriteFileSync(fp, JSON.stringify(this.createdOrders));
    } catch { /* best effort */ }
  }

  async list(
    params?: ListParams & { companyId?: string; status?: string; sort?: string }
  ): Promise<PaginatedResponse<Order>> {
    await randomDelay();
    // Test-only fault injection for the `pax8 orders list` timeout-hint UX
    // (#199). When this env var is set the demo mock raises the same shape
    // of error the real `Pax8Client` AbortController path throws: an
    // `ApiError` with `statusCode === 0` and a "Request timed out after Nms"
    // message. Scoped to demo mode only; the real API client never reads
    // this var. We can't `import { ApiError }` here (circular import risk),
    // so the equivalent shape is built by hand below and the CLI's
    // `isApiTimeoutError` predicate sees it as a timeout.
    if (process.env.PAX8_DEMO_FAIL_ORDERS_LIST_TIMEOUT) {
      throw new ApiError(
        "Request timed out after 30000ms",
        0,
        "/orders",
        "GET",
      );
    }
    let filtered = [...orders, ...this.loadCreated()];
    if (params?.companyId) {
      filtered = filtered.filter((o) => o.companyId === params.companyId);
    }
    if (params?.status) {
      const s = params.status.toLowerCase();
      filtered = filtered.filter((o) => o.status.toLowerCase() === s);
    }
    // #478: honor the `sort=<field>,<direction>` hint so the demo posture
    // exercises the same code path partners take on real traffic. Default
    // is `createdAt,desc` (newest first) — pre-#478 the CLI passed nothing
    // and the large fixture surfaced 2013 archives in row 1.
    if (params?.sort) {
      const [field, direction] = params.sort.split(",").map((s) => s.trim());
      const dir = (direction ?? "asc").toLowerCase() === "desc" ? -1 : 1;
      const getField = (o: Order): string | number => {
        // #385 / #476: `createdAt` is canonical; `createdDate` was the
        // pre-removal alias. The mock honors both spellings on the
        // input `sort` param (real Pax8 API still accepts both wire
        // names) but the underlying Order field is just `createdAt`.
        if (field === "createdAt" || field === "createdDate") {
          return o.createdAt ?? "";
        }
        return "";
      };
      filtered = [...filtered].sort((a, b) => {
        const av = getField(a);
        const bv = getField(b);
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }
    const page = paginate(filtered, params);
    return page;
  }

  async get(id: string): Promise<Order> {
    await randomDelay();
    const allOrders = [...orders, ...this.loadCreated()];
    const order = allOrders.find((o) => o.id === id);
    if (!order) throw notFound("Order", id);
    return order;
  }

  async create(
    data: CreateOrderInput,
    opts?: { isMock?: boolean },
  ): Promise<Order> {
    await randomDelay();
    // Resolve company name from demo data
    const company = companies.find((c) => c.id === data.companyId);
    const newOrder: Order = {
      // Dry-run responses use a synthetic prefix so consumers can tell at a
      // glance the order wasn't persisted. Real demo creates keep the
      // historical `ord-demo-` prefix.
      id: opts?.isMock ? `ord-dryrun-${Date.now()}` : `ord-demo-${Date.now()}`,
      companyId: data.companyId,
      companyName: company?.name ?? "Unknown",
      orderedBy: "Demo User",
      orderedByEmail: "demo@example.com",
      createdAt: new Date().toISOString().split("T")[0],
      // Echo `lineItemNumber` back so callers can verify it was sent. Falls
      // back to 1-based array position when callers don't supply one — same
      // behavior `OrdersApi.create()` enforces on the real wire path (#331).
      lineItems: data.lineItems.map((li, idx) => ({
        productId: li.productId,
        productName: products.find((p) => p.id === li.productId)?.name ?? "Unknown",
        lineItemNumber: li.lineItemNumber ?? idx + 1,
        quantity: li.quantity,
        billingTerm: (li.billingTerm ?? "Monthly") as "Monthly" | "Annual",
        // Echo `provisioningDetails` back so callers can verify the
        // spec-shaped array (`{key, values: string[]}[]`) was sent on
        // the wire (#332).
        ...(li.provisioningDetails && li.provisioningDetails.length > 0
          ? { provisioningDetails: li.provisioningDetails }
          : {}),
      })),
      // Status stays "Processing" even for dry-runs to keep the demo Order
      // type narrow. The CLI knows it's a dry-run from the request flag and
      // banners the response accordingly; the synthetic id prefix is the
      // mock client's signal to anyone introspecting the response.
      status: "Processing",
    };
    // Only persist when this is a real order — dry-runs never hit the
    // demo-orders.json file.
    if (!opts?.isMock) {
      this.loadCreated().push(newOrder);
      this.saveCreated();
    }
    return newOrder;
  }
}

class ContactsResource {
  // Mirrors ContactsApi — every method threads companyId as the first argument
  // because the Pax8 public spec only addresses contacts under the nested
  // `/companies/{companyId}/contacts[/{contactId}]` paths.
  async list(
    companyId: string,
    params?: ListParams,
  ): Promise<PaginatedResponse<Contact>> {
    await randomDelay();
    const filtered = contacts.filter((c) => c.companyId === companyId);
    return paginate(filtered, params);
  }

  async get(companyId: string, contactId: string): Promise<Contact> {
    await randomDelay();
    const contact = contacts.find(
      (c) => c.id === contactId && c.companyId === companyId,
    );
    if (!contact) throw notFound("Contact", contactId);
    return contact;
  }

  async create(companyId: string, data: Partial<Contact>): Promise<Contact> {
    await randomDelay();
    // Per the public spec (#325), the wire shape of `types` is an array of
    // `{type, primary}` objects, not bare enum strings. The mock falls back
    // to a single primary Admin entry when callers omit `types` so demo
    // round-trips still produce a parse-clean Contact.
    const newContact: Contact = {
      id: `contact-demo-${Date.now()}`,
      companyId,
      firstName: data.firstName ?? "",
      lastName: data.lastName ?? "",
      email: data.email ?? "",
      ...(data.phone ? { phone: data.phone } : {}),
      types:
        data.types && data.types.length > 0
          ? data.types
          : [{ type: "Admin", primary: true }],
    };
    return newContact;
  }

  async update(
    companyId: string,
    contactId: string,
    data: Partial<Contact>,
  ): Promise<Contact> {
    await randomDelay();
    const contact = contacts.find(
      (c) => c.id === contactId && c.companyId === companyId,
    );
    if (!contact) throw notFound("Contact", contactId);
    return { ...contact, ...data, id: contact.id, companyId: contact.companyId };
  }

  async delete(companyId: string, contactId: string): Promise<void> {
    await randomDelay();
    const contact = contacts.find(
      (c) => c.id === contactId && c.companyId === companyId,
    );
    if (!contact) throw notFound("Contact", contactId);
  }
}

class UsageResource {
  async listSummaries(
    subscriptionId: string,
    params?: ListParams & { resourceGroup?: string }
  ): Promise<PaginatedResponse<UsageSummary>> {
    await randomDelay();
    let filtered = usageSummaries.filter(
      (u) => u.subscriptionId === subscriptionId,
    );
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
  /**
   * Project a stored `DemoQuote` (wire-shape, with nested `client: {...}`)
   * through `QuoteSchema` so demo-mode callers see the same canonical
   * `Quote` (with flat `companyId`) the real API client returns after
   * parsing. Demo data is wire-shape per #384 so the same Zod preprocess
   * exercised against the real API runs in demo mode too — that's the
   * point of the issue.
   */
  private project(q: DemoQuote): Quote {
    return QuoteSchema.parse(q);
  }

  async list(
    params?: ListParams & { companyId?: string; status?: string }
  ): Promise<PaginatedResponse<Quote>> {
    await randomDelay();
    let filtered = quotes;
    if (params?.companyId) {
      // Demo data stores the wire-shape nested `client.id` (#384). The
      // CLI flag still resolves to a flat `companyId` query param on the
      // public API — match by `client.id` here so the demo filter agrees
      // with the wire-side filter the real API runs.
      filtered = filtered.filter((q) => q.client.id === params.companyId);
    }
    if (params?.status) {
      // Mirror the real API's server-side filter (#387). Demo `Quote.status`
      // is titlecased ("Draft", "Sent", ...) while the wire enum is lowercase
      // ("draft", "sent", ...) — compare case-insensitively so either form
      // works against demo mode.
      const s = params.status.toLowerCase();
      filtered = filtered.filter((q) => String(q.status).toLowerCase() === s);
    }
    const page = paginate(filtered, params);
    return { ...page, content: page.content.map((q) => this.project(q)) };
  }

  async get(id: string): Promise<Quote> {
    await randomDelay();
    const quote = quotes.find((q) => q.id === id);
    if (!quote) throw notFound("Quote", id);
    return this.project(quote);
  }

  /**
   * Create an empty draft quote against the v2 body shape `{ clientId,
   * quoteRequestId? }`. Line items are added separately via `addLineItem`
   * after creation — `POST /v2/quotes` does not accept `lineItems`. See #311
   * and `docs/triage/quotes-api-version.md` §9.1.
   *
   * The legacy `companyId` / `lineItems` fields are still tolerated on the
   * `data` parameter for back-compat with older callers that may pass them;
   * they're ignored except for resolving the client/company linkage so demo
   * mode behaves the same as the real v2 API. The schema (`CreateQuoteInput`)
   * is now strict — `{ clientId, quoteRequestId? }`.
   */
  async create(
    data: { clientId?: string; quoteRequestId?: string; companyId?: string },
  ): Promise<Quote> {
    await randomDelay();
    const clientId = data.clientId ?? data.companyId ?? "";
    const clientName = companies.find((c) => c.id === clientId)?.name;
    const newQuote: DemoQuote = {
      id: `quote-demo-${Date.now()}`,
      // Wire-shape nested client per #384. Demo data stores the same shape
      // the real /v2/quotes API returns; `QuoteSchema` flattens it on the
      // way out (see `project()` above).
      client: {
        id: clientId,
        isShadowCompany: false,
        ...(clientName ? { name: clientName } : {}),
      },
      createdAt: new Date().toISOString().split("T")[0],
      status: "Draft",
      // Empty defaults for the two free-text fields the v2 read shape marks
      // required (#313). Real partners populate these via the marketplace UI
      // before sending; demo mode mirrors the "empty draft" wire shape with
      // empty strings rather than missing fields so schema parsing succeeds.
      introMessage: "",
      termsAndDisclaimers: "",
      lineItems: [],
    };
    // Push into the in-memory fixture so a follow-up `addLineItem` /
    // `get` / `setStatus` on the freshly-created quote ID resolves in
    // demo mode. This mirrors the real v2 API where the returned quote
    // ID is immediately addressable by subsequent calls. Important for
    // the `quotes create --product ...` shorthand path, which chains a
    // create + line-item add in a single command (#311).
    quotes.push(newQuote);
    return this.project(newQuote);
  }

  /**
   * Apply a partial set of overrides to a quote, mirroring the v2
   * `PUT /v2/quotes/{id}` semantics (#313). The real API requires all five
   * mutable fields on every PUT; the `QuotesApi.update` wrapper in
   * `@pax8/core` does the fetch-then-merge before sending. In demo mode the
   * mock is the wrapper, so we just merge the overrides into the in-memory
   * fixture. Status transitions ride this same code path (#314): when
   * `status` is included as an override, we lowercase-to-titlecase map it
   * exactly like `setStatus` does so the demo `Quote.status` field stays
   * inside its tight union.
   */
  async update(
    id: string,
    data: {
      expiresOn?: string;
      introMessage?: string;
      published?: boolean;
      status?: QuoteStatusTransition;
      termsAndDisclaimers?: string;
    },
  ): Promise<Quote> {
    await randomDelay();
    const quote = quotes.find((q) => q.id === id);
    if (!quote) throw notFound("Quote", id);

    if (typeof data.expiresOn === "string") {
      quote.expiresAt = data.expiresOn;
    }
    if (typeof data.introMessage === "string") quote.introMessage = data.introMessage;
    if (typeof data.published === "boolean") quote.published = data.published;
    if (typeof data.termsAndDisclaimers === "string") {
      quote.termsAndDisclaimers = data.termsAndDisclaimers;
    }
    if (data.status) {
      const cap = data.status.charAt(0).toUpperCase() + data.status.slice(1);
      const allowed: Record<string, DemoQuote["status"]> = {
        Draft: "Draft",
        Sent: "Sent",
        Accepted: "Accepted",
        Declined: "Declined",
      };
      quote.status = allowed[cap] ?? quote.status;
    }
    return this.project(quote);
  }

  async delete(id: string): Promise<void> {
    await randomDelay();
    const quote = quotes.find((q) => q.id === id);
    if (!quote) throw notFound("Quote", id);
  }

  /**
   * Append a single line item to a draft quote. Mutates the in-memory demo
   * fixture so a follow-up `quotes show` reflects the new line. Returns the
   * (now-mutated) quote so callers don't need to re-fetch.
   */
  async addLineItem(
    quoteId: string,
    input: AddQuoteLineItemInput,
  ): Promise<Quote> {
    await randomDelay();
    // Test-only fault injection for the `quotes create --product ...`
    // partial-failure recovery hint (#311). When this env var is set, the
    // demo mock simulates an upstream 5xx on the line-item add so the
    // subprocess test can assert the "Quote created but line-item add
    // failed; recover with ..." UX. Scoped to demo mode only; the real API
    // client never reads this var.
    if (process.env.PAX8_DEMO_FAIL_QUOTE_LINE_ITEM_ADD) {
      throw new Error("Simulated upstream failure on POST /v2/quotes/{id}/line-items");
    }
    const quote = quotes.find((q) => q.id === quoteId);
    if (!quote) throw notFound("Quote", quoteId);
    // Prefer the explicit `input.price` (required since #312 to mirror the
    // v2 `AddStandardLineItemPayload` schema). Fall back to the demo
    // product's plan price only if the caller bypassed the CLI layer and
    // somehow handed us an input without a price. Pricing lookups silently
    // fall through — a missing price just means the line shows "—" in the UI.
    const product = products.find((p) => p.id === input.productId);
    const term = input.billingTerm ?? "Monthly";
    const plan = product?.pricing.find((p) => p.billingTerm === term);
    const unitPrice =
      typeof input.price === "number" ? input.price : plan?.partnerBuyPrice;
    const newId = `li-demo-${Date.now()}`;
    // Round-trip `commitmentTermId` back onto the line as a
    // `commitmentTerm: { id, term }` object, mirroring the real v2 read
    // shape (`LineItemResponse.commitmentTerm`). The `term` label is
    // inferred from the input billing term so a `--commitment-term 1-Year`
    // call surfaces "1-Year" on the rendered line; if the caller bypassed
    // the CLI's enum and only supplied the UUID, we fall back to an empty
    // string so the line still parses.
    const commitmentTerm = input.commitmentTermId
      ? {
          id: input.commitmentTermId,
          // Demo-only inference — the real API stores the canonical term
          // server-side. Use the billing term as a sensible label when
          // the caller didn't pass a term flag.
          term:
            input.billingTerm === "Annual"
              ? "1-Year"
              : (input.billingTerm ?? "Monthly"),
        }
      : undefined;
    const newLine = {
      id: newId,
      productId: input.productId,
      quantity: input.quantity,
      ...(input.billingTerm ? { billingTerm: input.billingTerm } : {}),
      ...(typeof unitPrice === "number"
        ? { unitPrice, subtotal: unitPrice * input.quantity }
        : {}),
      ...(commitmentTerm ? { commitmentTerm } : {}),
    };
    quote.lineItems = [...(quote.lineItems ?? []), newLine];
    return this.project(quote);
  }

  async removeLineItem(quoteId: string, lineItemId: string): Promise<void> {
    await randomDelay();
    const quote = quotes.find((q) => q.id === quoteId);
    if (!quote) throw notFound("Quote", quoteId);
    const items = quote.lineItems ?? [];
    const idx = items.findIndex((li) => li.id === lineItemId);
    if (idx < 0) throw notFound("QuoteLineItem", lineItemId);
    items.splice(idx, 1);
    quote.lineItems = items;
  }

  /**
   * Demo-mode status transitions. Delegates to `update` so the mock surface
   * mirrors the real `QuotesApi` where status flips ride the same fetch-then-
   * merge `PUT /v2/quotes/{id}` as every other update (#314).
   */
  async setStatus(id: string, status: QuoteStatusTransition): Promise<Quote> {
    return this.update(id, { status });
  }

  async send(id: string): Promise<Quote> {
    return this.setStatus(id, "sent");
  }
}

// Mock surface mirrors the real @pax8/core WebhooksApi:
//   list()       → Webhook[]
//   create(data) → Webhook
//   get(id)      → Webhook
//   updateConfiguration(id, c)  → Webhook (POST /webhooks/{id}/configuration)
//   setStatus(id, active)       → Webhook (POST /webhooks/{id}/status)
//   delete(id)   → void
//   test(id)     → unknown (returns a small structured payload here)
//   testTopic(id, topic)    → unknown
//   getLogs(id)  → WebhookLog[]
//   retryLog(id, logId) → unknown
//   getTopicDefinitions()   → WebhookTopicDefinition[]
class WebhooksResource {
  async list(): Promise<Webhook[]> {
    await randomDelay();
    return webhooks;
  }

  async get(id: string): Promise<Webhook> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    return wh;
  }

  async create(data: {
    url: string;
    displayName: string;
    webhookTopics: Array<{ topic: string; filters?: unknown[] }>;
  }): Promise<Webhook> {
    await randomDelay();
    // Generate a deterministic-ish UUID-shaped id for demo mode.
    const newId = `99999999-aaaa-bbbb-cccc-${String(Date.now()).padStart(12, "0").slice(-12)}`;
    // `WebhookSchema` (the read shape) still surfaces `topics: string[]` to
    // CLI consumers, so we flatten the structured `webhookTopics` input back
    // down to a slug list on the returned record. The structured read-side
    // (`webhookTopics: Array<{topic, filters}>`) is tracked separately under
    // #323's "out of scope" read-schema realignment step.
    const newWh: Webhook = {
      id: newId,
      url: data.url,
      status: "Active",
      topics: data.webhookTopics.map((t) => t.topic),
      createdAt: new Date().toISOString().split("T")[0],
      secret: `whsec_demo_${Date.now()}`,
      displayName: data.displayName,
    };
    return newWh;
  }

  async updateConfiguration(
    id: string,
    data: {
      displayName?: string;
      url?: string;
      authorization?: string;
      contactEmail?: string;
      errorThreshold?: number;
    },
  ): Promise<Webhook> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    // Return a merged copy without mutating the canonical demo record — keeps
    // tests order-independent. `authorization` is a write-only secret on the
    // real API and is not echoed back on read, so we don't include it.
    const { authorization: _ignored, ...rest } = data;
    void _ignored;
    return {
      ...wh,
      ...rest,
      id: wh.id,
      updatedAt: new Date().toISOString(),
    };
  }

  async setStatus(id: string, active: boolean): Promise<Webhook> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    const updated: Webhook = {
      ...wh,
      status: active ? "Active" : "Disabled",
      updatedAt: new Date().toISOString(),
    };
    return updated;
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

  async testTopic(id: string, topic: string): Promise<unknown> {
    await randomDelay();
    const wh = webhooks.find((w) => w.id === id);
    if (!wh) throw notFound("Webhook", id);
    const known = webhookTopicDefinitions.some((t) => t.topic === topic);
    if (!known) throw notFound("WebhookTopic", topic);
    return {
      success: wh.status === "Active",
      responseCode: wh.status === "Active" ? 200 : 502,
      topic,
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

  async getTopicDefinitions(): Promise<WebhookTopicDefinition[]> {
    await randomDelay();
    return [...webhookTopicDefinitions];
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
