// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { replCmd } from "../lib/confirm.js";
import { CredentialStore, getConfigDir, getDefaultBaseUrl } from "@pax8/core";
import { getOutputFormat, resolveDemoModeAsync } from "../lib/context.js";

// Build-time injected by tsup (see packages/cli/tsup.config.ts). At runtime
// inside `pax8 doctor --json` we surface this in the structured envelope so
// agents can echo it back in bug reports without a second `pax8 --version`
// round-trip.
declare const __CLI_VERSION__: string;

// Honor PAX8_CONFIG_DIR (set in CI / tests / non-default installs) instead
// of hardcoding `~/.pax8`. Same env contract as every other read of the
// config dir in core.
const CONFIG_DIR = getConfigDir();
const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml");
const CACHE_DIR = path.join(CONFIG_DIR, "cache");

const isDemoMode = resolveDemoModeAsync;

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

async function checkApiBase(): Promise<CheckResult> {
  const base = getDefaultBaseUrl();
  const isProd = base.replace(/\/+$/, "") === "https://api.pax8.com/v1";
  const overridden = !!process.env.PAX8_API_BASE;
  const detail = overridden
    ? `${base} (overridden via PAX8_API_BASE${isProd ? "" : " — non-prod"})`
    : `${base} (default)`;
  return { name: "API base URL", passed: true, detail };
}

async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.versions.node;
  const major = parseInt(version.split(".")[0], 10);
  return {
    name: "Node.js version >= 20",
    passed: major >= 20,
    detail: `v${version}`,
  };
}

async function checkConfigFile(): Promise<CheckResult> {
  try {
    await fs.access(CONFIG_FILE);
    return { name: "Config file", passed: true, detail: CONFIG_FILE };
  } catch {
    // The config file is one of *several* ways credentials reach the CLI.
    // It's only a real problem when nothing else covers them (#220):
    //   - PAX8_DEMO=1 → no credentials needed at all
    //   - PAX8_CLIENT_ID + PAX8_CLIENT_SECRET → env-var auth, common in CI
    //     and service-account setups; no config file required
    // Marking this ✗ when either of those covers it scares users on a
    // working system and fails CI runners running on fresh checkouts.
    if (process.env.PAX8_DEMO === "1") {
      return {
        name: "Config file",
        passed: true,
        detail: "demo mode — not required",
      };
    }
    if (process.env.PAX8_CLIENT_ID && process.env.PAX8_CLIENT_SECRET) {
      return {
        name: "Config file",
        passed: true,
        detail: "using env vars — PAX8_CLIENT_ID / PAX8_CLIENT_SECRET",
      };
    }
    return {
      name: "Config file",
      passed: false,
      detail: `Not found. Run: ${replCmd("pax8 config init")}`,
    };
  }
}

async function checkAuth(): Promise<CheckResult> {
  const isDemo = await isDemoMode();
  if (isDemo) {
    return { name: "Authentication configured", passed: true, detail: "Demo mode" };
  }

  const store = new CredentialStore();
  const creds = await store.getCredentials();
  if (creds) {
    const masked =
      creds.clientId.length > 8
        ? creds.clientId.slice(0, 4) + "…" + creds.clientId.slice(-4)
        : "****";
    return { name: "Authentication configured", passed: true, detail: `Client ID: ${masked}` };
  }
  return {
    name: "Authentication configured",
    passed: false,
    detail: `No credentials found. Run: ${replCmd("pax8 auth login")}`,
  };
}

async function checkTokenFetch(): Promise<CheckResult> {
  const isDemo = await isDemoMode();
  if (isDemo) {
    return { name: "Token fetch", passed: true, detail: "Skipped (demo mode)" };
  }

  // In non-demo mode without credentials, skip token test
  const store = new CredentialStore();
  const creds = await store.getCredentials();
  if (!creds) {
    return { name: "Token fetch", passed: false, detail: "No credentials — skipped" };
  }

  try {
    const { TokenManager } = await import("@pax8/core");
    const tm = new TokenManager({ clientId: creds.clientId, clientSecret: creds.clientSecret });
    await tm.getToken();
    return { name: "Token fetch", passed: true, detail: "Token acquired successfully" };
  } catch (err) {
    return {
      name: "Token fetch",
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkApiHealth(): Promise<CheckResult[]> {
  const isDemo = await isDemoMode();
  if (isDemo) {
    return [{ name: "API endpoints", passed: true, detail: "Demo mode — mock API" }];
  }

  const store = new CredentialStore();
  const creds = await store.getCredentials();
  if (!creds) {
    return [{ name: "API endpoints", passed: false, detail: "No credentials — skipped" }];
  }

  const { TokenManager, Pax8Client, CompaniesApi, SubscriptionsApi, ProductsApi, InvoicesApi, OrdersApi } = await import("@pax8/core");
  const tm = new TokenManager({ clientId: creds.clientId, clientSecret: creds.clientSecret });
  const client = new Pax8Client({ tokenManager: tm, cacheTtlMs: 0 });

  const endpoints: Array<{ name: string; fn: () => Promise<unknown> }> = [
    { name: "Companies", fn: () => new CompaniesApi(client).list({ size: 1 }) },
    { name: "Subscriptions", fn: () => new SubscriptionsApi(client).list({ size: 1 }) },
    { name: "Products", fn: () => new ProductsApi(client).list({ size: 1 }) },
    { name: "Invoices", fn: () => new InvoicesApi(client).list({ size: 1 }) },
    { name: "Orders", fn: () => new OrdersApi(client).list({ size: 1 }) },
  ];

  const results: CheckResult[] = [];
  let passed = 0;
  const total = endpoints.length;

  // Run all endpoint checks in parallel
  const start = Date.now();
  const settled = await Promise.allSettled(endpoints.map((ep) => ep.fn()));
  const wallTime = Date.now() - start;

  for (const s of settled) {
    if (s.status === "fulfilled") passed++;
  }

  const avgLatency = Math.round(wallTime / total);
  const speed = avgLatency < 2000 ? "fast" : avgLatency < 10000 ? "slow" : "very slow";

  results.push({
    name: "API endpoints",
    passed: passed === total,
    detail: `${passed}/${total} reachable · avg ${avgLatency}ms ${avgLatency > 5000 ? "⚠ " + speed : speed}`,
  });

  return results;
}

interface McpJson {
  mcpServers?: {
    pax8?: {
      url?: string;
      headers?: Record<string, string>;
    };
  };
}

async function findMcpJson(startDir: string): Promise<string | null> {
  let dir = startDir;
  // Walk up at most 8 levels to avoid pathological traversal
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, ".mcp.json");
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // not here, walk up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function checkMcp(opts?: {
  cwd?: string;
  fetchImpl?: typeof fetch;
}): Promise<CheckResult> {
  const name = "MCP server";
  const isDemo = await isDemoMode();
  if (isDemo) {
    return { name, passed: true, detail: "Demo mode — MCP check skipped." };
  }

  const startDir = opts?.cwd ?? process.cwd();
  const mcpPath = await findMcpJson(startDir);
  if (!mcpPath) {
    return {
      name,
      passed: true,
      detail:
        ".mcp.json not found — MCP not configured (skip if you don't use Claude/Cursor/Copilot)",
    };
  }

  let parsed: McpJson;
  try {
    const raw = await fs.readFile(mcpPath, "utf8");
    parsed = JSON.parse(raw) as McpJson;
  } catch (err) {
    return {
      name,
      passed: false,
      detail: `Failed to parse ${mcpPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const server = parsed.mcpServers?.pax8;
  const url = server?.url;
  const token = server?.headers?.["x-pax8-mcp-token"];
  if (!url || !token) {
    return {
      name,
      passed: false,
      detail: ".mcp.json found but missing pax8 server url or x-pax8-mcp-token header.",
    };
  }

  const doFetch = opts?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await doFetch(url, {
      method: "GET",
      headers: { "x-pax8-mcp-token": token, accept: "application/json, text/event-stream" },
      signal: controller.signal,
    });
    if (res.status >= 200 && res.status < 300) {
      return { name, passed: true, detail: "MCP server reachable, token valid" };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        name,
        passed: false,
        detail:
          "MCP token invalid or revoked. Regenerate at https://app.pax8.com/integrations/mcp",
      };
    }
    // Other 4xx (e.g. 405 from a streamable-HTTP MCP that rejects bare GET) means
    // we reached the server — token shape unverified, but no point failing doctor.
    return {
      name,
      passed: true,
      detail: `MCP server reachable (HTTP ${res.status}); token shape unverified`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name,
      passed: false,
      detail: `MCP server unreachable. Check network/firewall. (${msg})`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkCredentialPermissions(): Promise<CheckResult> {
  const store = new CredentialStore();
  const result = await store.checkPermissions();
  return {
    name: "Credential file permissions",
    passed: result.secure,
    detail: result.detail,
  };
}

async function checkTelemetry(): Promise<CheckResult> {
  try {
    const { loadConfig } = await import("@pax8/core");
    const config = await loadConfig();
    const enabled = config.telemetry?.enabled === true;
    return {
      name: "Telemetry",
      passed: true,
      detail: enabled ? "Enabled — sending to PostHog" : "Disabled",
    };
  } catch {
    return { name: "Telemetry", passed: true, detail: "Disabled" };
  }
}

async function checkCacheDir(): Promise<CheckResult> {
  const noCache = process.env.PAX8_NO_CACHE === "1" || process.env.PAX8_NO_CACHE === "true";
  let cacheEnabled = false;
  let ttlHours = 24;
  if (!noCache) {
    try {
      const { loadConfig } = await import("@pax8/core");
      const cfg = await loadConfig();
      cacheEnabled = cfg.cache?.enabled ?? false;
      ttlHours = cfg.cache?.ttl_hours ?? 24;
    } catch {
      // config unreadable — treat as disabled
    }
  }

  let entryCount = 0;
  let totalBytes = 0;
  try {
    const files = await fs.readdir(CACHE_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    entryCount = jsonFiles.length;
    for (const f of jsonFiles) {
      try {
        const stat = await fs.stat(path.join(CACHE_DIR, f));
        totalBytes += stat.size;
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    // cache dir doesn't exist yet — that's fine
  }

  const kb = (totalBytes / 1024).toFixed(1);
  const sizeStr = entryCount > 0 ? `, ${entryCount} entries (${kb} KB)` : ", empty";
  const detail = noCache
    ? "disabled via PAX8_NO_CACHE"
    : cacheEnabled
      ? `enabled — ${ttlHours}h TTL${sizeStr}`
      : "disabled — set cache.enabled: true in ~/.pax8/config.yaml to enable";

  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const testFile = path.join(CACHE_DIR, ".write-test");
    await fs.writeFile(testFile, "test");
    await fs.unlink(testFile);
    return { name: "Cache", passed: true, detail };
  } catch {
    return {
      name: "Cache",
      passed: false,
      detail: `Cannot write to ${CACHE_DIR}`,
    };
  }
}

export const doctorCommand = new Command("doctor")
  .description("Run diagnostic checks")
  .addHelpText(
    "after",
    `
Examples:
  pax8 doctor
  pax8 doctor --json

  # macOS / Linux
  PAX8_DEMO=1 pax8 doctor

  # PowerShell
  $env:PAX8_DEMO="1"; pax8 doctor`
  )
  .action(async (_options, command: Command) => {
    // Honor --json (#470). Reading globals via optsWithGlobals lets a piped
    // agent invocation (`pax8 doctor --json | jq`) get structured output
    // rather than the ANSI banner that previously went to stdout
    // unconditionally. The human branch below is unchanged.
    const allOpts = command.optsWithGlobals();
    const outputFormat = getOutputFormat(allOpts);
    const jsonMode = outputFormat === "json";

    if (!jsonMode) {
      process.stdout.write(chalk.bold("\n  Pax8 CLI — Diagnostics\n\n"));
    }

    // Run all checks in parallel for speed
    const [nodeV, apiBase, configF, authC, credPerms, tokenC, apiCs, cacheC, telC, mcpC] = await Promise.all([
      checkNodeVersion(),
      checkApiBase(),
      checkConfigFile(),
      checkAuth(),
      checkCredentialPermissions(),
      checkTokenFetch(),
      checkApiHealth(),
      checkCacheDir(),
      checkTelemetry(),
      checkMcp(),
    ]);
    const checks: CheckResult[] = [nodeV, apiBase, configF, authC, credPerms, tokenC, ...apiCs, cacheC, telC, mcpC];

    let allPassed = true;
    for (const check of checks) {
      if (!check.passed) allPassed = false;
    }

    if (jsonMode) {
      const version =
        typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.1.0";
      const summary = {
        total: checks.length,
        passed: checks.filter((c) => c.passed).length,
        failed: checks.filter((c) => !c.passed).length,
        allPassed,
      };

      // Per-§12 "Next-action hints": single-object summaries carry
      // `nextActions` inline. Surface only the most useful follow-ups based
      // on what failed; cap at five.
      const nextActions: { command: string; description: string }[] = [];
      const authFailed = checks.find(
        (c) => c.name === "Authentication configured" && !c.passed,
      );
      if (authFailed) {
        nextActions.push({
          command: "pax8 auth login --client-id <id> --client-secret <secret>",
          description: "Authenticate so subsequent commands can reach the Pax8 API",
        });
      }
      const configFailed = checks.find(
        (c) => c.name === "Config file" && !c.passed,
      );
      if (configFailed) {
        nextActions.push({
          command: "pax8 config init",
          description: "Create the local config file at ~/.pax8/config.yaml",
        });
      }
      const tokenFailed = checks.find(
        (c) => c.name === "Token fetch" && !c.passed,
      );
      if (tokenFailed) {
        nextActions.push({
          command: "pax8 auth login",
          description: "Re-authenticate — current credentials are not exchangeable for a token",
        });
      }
      if (allPassed) {
        nextActions.push({
          command: "pax8 dashboard --json",
          description: "Diagnostics clean — pull a portfolio summary to confirm end-to-end",
        });
      }

      process.stdout.write(
        JSON.stringify(
          { checks, summary, version, nextActions },
          null,
          2,
        ) + "\n",
      );
      return;
    }

    // Human path — unchanged. Banner already emitted above.
    for (const check of checks) {
      const icon = check.passed ? chalk.green("✓") : chalk.red("✗");
      const detail = check.detail ? chalk.dim(` (${check.detail})`) : "";
      process.stdout.write(`  ${icon} ${check.name}${detail}\n`);
    }

    process.stdout.write("\n");

    if (allPassed) {
      process.stdout.write(
        chalk.green("  All checks passed!\n\n")
      );
    } else {
      process.stdout.write(
        chalk.yellow("  Some checks failed. See details above.\n\n")
      );
    }
  });
