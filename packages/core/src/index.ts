// API types, schemas, client, and resource modules
export * from "./api/types.js";
export * from "./api/errors.js";
export { Pax8Client } from "./api/client.js";
export type { Pax8ClientOptions } from "./api/client.js";
export { CompaniesApi } from "./api/companies.js";
export { ContactsApi } from "./api/contacts.js";
export { ProductsApi } from "./api/products.js";
export { OrdersApi } from "./api/orders.js";
export { SubscriptionsApi } from "./api/subscriptions.js";
export { InvoicesApi } from "./api/invoices.js";
export { UsageApi } from "./api/usage.js";
export { QuotesApi } from "./api/quotes.js";
export { WebhooksApi } from "./api/webhooks.js";

// Auth
export * from "./auth/index.js";

// Services
export * from "./services/index.js";

// Config
export * from "./config/index.js";

// Telemetry
export * from "./telemetry/index.js";

// Mock/demo - data arrays and mock client (types come from api/types.ts)
export {
  companies as demoCompanies,
  subscriptions as demoSubscriptions,
  products as demoProducts,
  invoices as demoInvoices,
  invoiceItems as demoInvoiceItems,
  orders as demoOrders,
  contacts as demoContacts,
  usageSummaries as demoUsageSummaries,
  usageLines as demoUsageLines,
  quotes as demoQuotes,
  webhooks as demoWebhooks,
  webhookLogs as demoWebhookLogs,
  webhookTopics as demoWebhookTopics,
  MockPax8Client,
} from "./mock/index.js";
