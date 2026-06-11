// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

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
  ERROR_AUTH_MISSING,
} from "@pax8/core";
import type { Config } from "@pax8/core";
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

// Compile-time assertion that `MockPax8Client` (used in demo mode) exposes
// every public method on the real `ApiClient`. We can't simply write
// `MockPax8Client extends ApiClient` because the real `*Api` classes carry a
// private `client` field used internally for HTTP, which TypeScript treats as
// a brand and refuses to consider compatible across class boundaries. Today's
// mock and real signatures also drift slightly (e.g. mock `companies.create`
// accepts `Partial<Company>` rather than `CreateCompanyInput`), and tightening
// those contracts is out of scope here — but adding or removing a method on
// either side IS what we want to catch automatically.
//
// So we project both sides through `MethodNames` and assert the mock has at
// least every public function-typed key the real client exposes. If a new
// method is added to any of the real `*Api` classes and to `ApiClient`, but
// not to its `*Resource` mirror in `MockPax8Client`, this assertion fails to
// type-check — turning the eventual runtime `TypeError` under `PAX8_DEMO=1`
// into a build-time error.
type MethodNames<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T];
type ApiClientMethodNames = {
  [K in keyof ApiClient]: MethodNames<ApiClient[K]>;
};
type MockMethodNames = {
  [K in keyof ApiClient]: MethodNames<MockPax8Client[K & keyof MockPax8Client]>;
};
type _AssertMockSatisfiesReal = ApiClientMethodNames extends MockMethodNames
  ? true
  : false;
const _mockSatisfiesReal: _AssertMockSatisfiesReal = true;
void _mockSatisfiesReal;

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
  parent?: unknown;
}

export function getOutputFormat(
  options: GlobalOptions,
  configDefault?: "table" | "json" | "csv",
): "table" | "json" | "csv" | "quiet" {
  // Explicit CLI flags always take priority
  if (options.quiet) return "quiet";
  if (options.json) return "json";
  if (options.csv) return "csv";

  // Escape hatch for subprocess tests that need to exercise the table-mode
  // render path (the human render only fires when stdout is a TTY, so without
  // this override the non-JSON branches are unreachable from a piped
  // subprocess). Accepted values: "table" | "json" | "csv" | "quiet".
  const forced = process.env.PAX8_OUTPUT_FORMAT;
  if (forced === "table" || forced === "json" || forced === "csv" || forced === "quiet") {
    return forced;
  }

  // Non-TTY (piped) output always defaults to JSON for machine consumption
  if (!process.stdout.isTTY) return "json";

  // In a TTY, use the config default if set, otherwise show a table
  return configDefault ?? "table";
}

/**
 * Centralized resolution of "is this invocation running in demo mode?".
 *
 * Precedence: env var (when set to a recognized literal — `1`, `true`,
 * `0`, `false`) overrides `config.demo` in either direction. Without the
 * falsy branch a user with `demo: true` in `~/.pax8/config.yaml` can't
 * temporarily switch to the real API via `PAX8_DEMO=false pax8 ...` —
 * they'd have to edit config.
 *
 * This logic historically lived inline at four sites (context, doctor,
 * the entry-point banner, the telemetry tag) with subtly different
 * precedence. Centralizing here is what closes the override bug —
 * fixing only `buildContext` left the banner and doctor flashing
 * "Demo mode" even when env said otherwise.
 *
 * Accepts an already-loaded config so callers can avoid a duplicate
 * disk read. `resolveDemoModeAsync()` loads config itself for sites
 * that don't have one yet.
 */
export function resolveDemoMode(config: { demo?: boolean }): boolean {
  const envDemo = process.env.PAX8_DEMO;
  if (envDemo === "1" || envDemo === "true") return true;
  if (envDemo === "0" || envDemo === "false") return false;
  return config.demo === true;
}

export async function resolveDemoModeAsync(): Promise<boolean> {
  const envDemo = process.env.PAX8_DEMO;
  if (envDemo === "1" || envDemo === "true") return true;
  if (envDemo === "0" || envDemo === "false") return false;
  try {
    const config = await loadConfig();
    return config.demo === true;
  } catch {
    return false;
  }
}

/**
 * Like `resolveDemoModeAsync` but also returns *where* demo mode came from
 * (`env` | `config` | `null`). Callers that need to tell users how to turn
 * demo off — `auth login`, `auth status`, `doctor` — use this so the hint
 * names the right thing (`unset PAX8_DEMO` vs `pax8 demo off`).
 *
 * Same precedence as `resolveDemoMode`: env literal wins (`1`/`true`/`0`/
 * `false`), then `config.demo`. Returns `source: null` when demo is off.
 */
export type DemoSource = "env" | "config" | null;
export async function resolveDemoModeWithSourceAsync(): Promise<{
  isDemo: boolean;
  source: DemoSource;
}> {
  const envDemo = process.env.PAX8_DEMO;
  if (envDemo === "1" || envDemo === "true") return { isDemo: true, source: "env" };
  if (envDemo === "0" || envDemo === "false") return { isDemo: false, source: null };
  try {
    const cfg = await loadConfig();
    if ("demo" in cfg && cfg.demo === true) return { isDemo: true, source: "config" };
  } catch {
    // Config unreadable — fall through; treat as demo off.
  }
  return { isDemo: false, source: null };
}

/**
 * The shell-friendly instruction for turning off demo mode, given its
 * source. Surfaced verbatim in user-facing copy from `auth login`,
 * `auth status`, and `doctor`. Centralized so the wording stays consistent.
 */
export function disableDemoHint(source: Exclude<DemoSource, null>): string {
  return source === "env"
    ? "unset PAX8_DEMO (or run with `PAX8_DEMO=0`)"
    : `run \`${replCmd("pax8 demo off")}\``;
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
    cache: { enabled: false, ttl_hours: 24 },
    telemetry: { enabled: false },
  }));

  // Extract `demo` rather than passing the whole Config union — the union
  // branch for an empty config object doesn't include `demo`, so passing
  // the bare `config` trips the TypeScript narrower. Pulling the field
  // first gives `resolveDemoMode` exactly the `{ demo?: boolean }` shape
  // its signature requires.
  const isDemo = resolveDemoMode({ demo: "demo" in config ? config.demo : undefined });
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
        ERROR_AUTH_MISSING,
      );
    }

    const tokenManager = new TokenManager({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    });

    // Plumb the documented `cache.enabled` / `cache.ttl_hours` config fields
    // through to `Pax8Client` so they actually take effect (#253). Previously
    // these were defined in the schema but never read here, so a user setting
    // `cache.enabled: false` in `~/.pax8/config.yaml` still got caching with
    // the constructor's hard-coded 1h default. `cacheTtlMs: 0` disables the
    // FileCache entirely inside `Pax8Client`.
    const envNoCache = process.env.PAX8_NO_CACHE;
    const noCache = envNoCache === "1" || envNoCache === "true";
    const cacheEnabled = !noCache && (config.cache?.enabled ?? false);
    const cacheTtlHours = config.cache?.ttl_hours ?? 24;
    const cacheTtlMs = cacheEnabled ? cacheTtlHours * 3_600_000 : 0;

    const client = new Pax8Client({
      tokenManager,
      debug: verbose,
      cacheTtlMs,
      // Per-API base URL overrides (#321). The Webhooks API lives at
      // `https://api.pax8.com/api/v2/webhooks/...` per the public webhooks
      // OpenAPI spec — a different *prefix* than the project-wide `/v1`
      // default. `WebhooksApi` opts into this base by passing
      // `{ api: "webhooks" }` on every call (#322); the entry below is what
      // routes those calls to the documented endpoint.
      apiBaseOverrides: {
        webhooks: "https://api.pax8.com/api/v2",
      },
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
