import {
  MockPax8Client,
  Pax8Client,
  CompaniesApi,
  ContactsApi,
  ProductsApi,
  OrdersApi,
  SubscriptionsApi,
  InvoicesApi,
  UsageApi,
  QuotesApi,
  WebhooksApi,
  TokenManager,
  CredentialStore,
  loadConfig,
} from "@pax8/core";
import type { Config } from "@pax8/core";
import { CliError } from "./errors.js";

export interface ApiClient {
  companies: CompaniesApi;
  subscriptions: SubscriptionsApi;
  products: ProductsApi;
  invoices: InvoicesApi;
  orders: OrdersApi;
  contacts: ContactsApi;
  usage: UsageApi;
  quotes: QuotesApi;
  webhooks: WebhooksApi;
}

export interface CommandContext {
  api: ApiClient | MockPax8Client;
  outputFormat: "table" | "json" | "csv" | "quiet";
  config: Config;
  isDemo: boolean;
  verbose: boolean;
}

export interface GlobalOptions {
  json?: boolean;
  csv?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  noColor?: boolean;
  config?: string;
  parent?: any;
}

export function getOutputFormat(
  options: GlobalOptions,
  configDefault?: "table" | "json" | "csv",
): "table" | "json" | "csv" | "quiet" {
  // Explicit CLI flags always take priority
  if (options.quiet) return "quiet";
  if (options.json) return "json";
  if (options.csv) return "csv";

  // Non-TTY (piped) output always defaults to JSON for machine consumption
  if (!process.stdout.isTTY) return "json";

  // In a TTY, use the config default if set, otherwise show a table
  return configDefault ?? "table";
}

export async function buildContext(
  options: GlobalOptions,
): Promise<CommandContext> {
  const verbose = options.verbose ?? false;

  const config = await loadConfig(options.config).catch(() => ({
    version: "1.0" as const,
    defaults: {
      output_format: "table" as const,
      page_size: 50,
      confirm_destructive: true,
    },
    cache: { enabled: true, ttl_hours: 24 },
    telemetry: { enabled: false },
  }));

  const isDemo = process.env.PAX8_DEMO === "1" || config.demo === true;
  const outputFormat = getOutputFormat(options, config.defaults?.output_format);

  let api: ApiClient | MockPax8Client;

  if (isDemo) {
    api = new MockPax8Client();
  } else {
    const credentialStore = new CredentialStore();
    const credentials = await credentialStore.getCredentials();

    if (!credentials) {
      throw new CliError(
        "Not authenticated",
        ["No Pax8 API credentials found"],
        [
          "Run: pax8 auth login --client-id <id> --client-secret <secret>",
          "Or set environment variables: export PAX8_CLIENT_ID=... && export PAX8_CLIENT_SECRET=... (macOS/Linux)",
          "  PowerShell: $env:PAX8_CLIENT_ID=\"...\"; $env:PAX8_CLIENT_SECRET=\"...\"",
          "Or use demo mode: PAX8_DEMO=1 pax8 <command> (macOS/Linux) or $env:PAX8_DEMO=\"1\"; pax8 <command> (PowerShell)",
        ],
        "https://devx.pax8.com/",
      );
    }

    const tokenManager = new TokenManager({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    });

    const client = new Pax8Client({
      tokenManager,
      debug: verbose,
    });

    api = {
      companies: new CompaniesApi(client),
      contacts: new ContactsApi(client),
      products: new ProductsApi(client),
      orders: new OrdersApi(client),
      subscriptions: new SubscriptionsApi(client),
      invoices: new InvoicesApi(client),
      usage: new UsageApi(client),
      quotes: new QuotesApi(client),
      webhooks: new WebhooksApi(client),
    };
  }

  // Fire-and-forget background cache warming for the most common queries.
  // This runs in parallel with the actual command so subsequent calls are instant.
  if (!isDemo) {
    warmCache(api as ApiClient);
  }

  return { api, outputFormat, config, isDemo, verbose };
}

/**
 * Pre-fetch commonly used endpoints in the background so they're cached
 * for the current command (if it needs them) and future commands.
 */
function warmCache(api: ApiClient): void {
  // Don't await — these run in the background.
  // Warm both the default page sizes and the large sizes used by --size 1000.
  api.companies.list({ page: 0, size: 200 }).catch(() => {});
  api.subscriptions.list({ page: 0, size: 200 }).catch(() => {});
  api.subscriptions.list({ page: 0, size: 1000 }).catch(() => {});
}
