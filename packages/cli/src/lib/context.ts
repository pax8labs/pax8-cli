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
  ConfigSchema,
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
  parent?: Record<string, unknown>;
}

export function getOutputFormat(
  options: GlobalOptions,
): "table" | "json" | "csv" | "quiet" {
  if (options.quiet) return "quiet";
  if (options.json) return "json";
  if (options.csv) return "csv";
  if (!process.stdout.isTTY) return "json";
  return "table";
}

export async function buildContext(
  options: GlobalOptions,
): Promise<CommandContext> {
  const isDemo = process.env.PAX8_DEMO === "1";
  const outputFormat = getOutputFormat(options);
  const verbose = options.verbose ?? false;

  const config = await loadConfig(options.config).catch(
    (): Config => ConfigSchema.parse({ version: "1.0" }),
  );

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
          "Run: pax8 auth login",
          "Or set PAX8_CLIENT_ID and PAX8_CLIENT_SECRET environment variables",
          "Or try demo mode: PAX8_DEMO=1 pax8 <command>",
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

  return { api, outputFormat, config, isDemo, verbose };
}
