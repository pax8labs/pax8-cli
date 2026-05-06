import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { replCmd } from "../lib/confirm.js";
import { CredentialStore, getDefaultBaseUrl, loadConfig } from "@pax8/core";

const CONFIG_DIR = path.join(os.homedir(), ".pax8");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml");
const CACHE_DIR = path.join(CONFIG_DIR, "cache");

async function isDemoMode(): Promise<boolean> {
  if (process.env.PAX8_DEMO === "1") return true;
  try {
    const config = await loadConfig();
    return config.demo === true;
  } catch { return false; }
}

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
    return { name: "Config file exists", passed: true, detail: CONFIG_FILE };
  } catch {
    return {
      name: "Config file exists",
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
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    // Try writing a test file
    const testFile = path.join(CACHE_DIR, ".write-test");
    await fs.writeFile(testFile, "test");
    await fs.unlink(testFile);
    return { name: "Cache directory writable", passed: true, detail: CACHE_DIR };
  } catch {
    return {
      name: "Cache directory writable",
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

  # macOS / Linux
  PAX8_DEMO=1 pax8 doctor

  # PowerShell
  $env:PAX8_DEMO="1"; pax8 doctor`
  )
  .action(async () => {
    process.stdout.write(chalk.bold("\n  Pax8 CLI — Diagnostics\n\n"));

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
      const icon = check.passed ? chalk.green("✓") : chalk.red("✗");
      const detail = check.detail ? chalk.dim(` (${check.detail})`) : "";
      process.stdout.write(`  ${icon} ${check.name}${detail}\n`);
      if (!check.passed) allPassed = false;
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
