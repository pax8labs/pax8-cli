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
import { spawn } from "node:child_process";
import { CliError } from "./errors.js";
import { replCmd } from "./confirm.js";

/**
 * Emit a stderr warning when a paginated result hits the page size limit,
 * indicating that results may be incomplete.
 */
export function warnIfTruncated(
  result: { content: unknown[] },
  pageSize: number,
): void {
  if (result.content.length >= pageSize) {
    process.stderr.write(
      `\n  ⚠ Returned ${result.content.length} subscriptions (page limit) — results may be incomplete. Use --size to increase.\n`,
    );
  }
}

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
          `Run: ${replCmd("pax8 auth login")} --client-id <id> --client-secret <secret>`,
          "Or set environment variables: export PAX8_CLIENT_ID=... && export PAX8_CLIENT_SECRET=... (macOS/Linux)",
          "  PowerShell: $env:PAX8_CLIENT_ID=\"...\"; $env:PAX8_CLIENT_SECRET=\"...\"",
          `Or use demo mode: PAX8_DEMO=1 ${replCmd("pax8")} <command> (macOS/Linux) or $env:PAX8_DEMO="1"; ${replCmd("pax8")} <command> (PowerShell)`,
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

  // Spawn a detached background process to warm the cache.
  // Skip if we're already a warmer child (prevents infinite recursion).
  if (!isDemo && !process.env.PAX8_CACHE_WARMING) {
    spawnCacheWarmer();
  }

  return { api, outputFormat, config, isDemo, verbose };
}

/**
 * Spawn a detached child process that runs common pax8 queries to warm the file cache.
 * The child is fully detached (stdio ignored, unref'd) so the parent exits immediately.
 */
function spawnCacheWarmer(): void {
  const env = { ...process.env, PAX8_CACHE_WARMING: "1" };

  const child = spawn(
    "pax8",
    ["companies", "list", "--json", "--size", "200", "--quiet"],
    { detached: true, stdio: "ignore", env },
  );
  child.on("error", (err) => {
    if (process.env.PAX8_DEBUG) process.stderr.write(`[debug] cache warmer (companies) failed: ${err}\n`);
  });
  child.unref();

  const child2 = spawn(
    "pax8",
    ["subscriptions", "list", "--json", "--size", "1000", "--quiet"],
    { detached: true, stdio: "ignore", env },
  );
  child2.on("error", (err) => {
    if (process.env.PAX8_DEBUG) process.stderr.write(`[debug] cache warmer (subscriptions) failed: ${err}\n`);
  });
  child2.unref();

  const child3 = spawn(
    "pax8",
    ["products", "list", "--json", "--size", "500", "--quiet"],
    { detached: true, stdio: "ignore", env },
  );
  child3.on("error", (err) => {
    if (process.env.PAX8_DEBUG) process.stderr.write(`[debug] cache warmer (products) failed: ${err}\n`);
  });
  child3.unref();
}
