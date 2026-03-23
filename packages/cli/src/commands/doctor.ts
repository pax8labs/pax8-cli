import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { replCmd } from "../lib/confirm.js";
import { CredentialStore } from "@pax8/core";

const CONFIG_DIR = path.join(os.homedir(), ".pax8");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml");
const CACHE_DIR = path.join(CONFIG_DIR, "cache");

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
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
  const isDemo = process.env.PAX8_DEMO === "1";
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
  const isDemo = process.env.PAX8_DEMO === "1";
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
  const isDemo = process.env.PAX8_DEMO === "1";
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
  let total = endpoints.length;

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

async function checkMcpServer(): Promise<CheckResult> {
  try {
    const mcpPath = path.join(process.cwd(), ".mcp.json");
    const content = await fs.readFile(mcpPath, "utf-8");
    const config = JSON.parse(content);
    const servers = Object.keys(config.mcpServers || {});
    if (servers.length === 0) {
      return { name: "MCP servers", passed: true, detail: "None configured" };
    }
    return {
      name: "MCP servers",
      passed: true,
      detail: servers.join(", "),
    };
  } catch {
    return { name: "MCP servers", passed: true, detail: "None configured" };
  }
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
    const [nodeV, configF, authC, tokenC, apiCs, cacheC, mcpC, telC] = await Promise.all([
      checkNodeVersion(),
      checkConfigFile(),
      checkAuth(),
      checkTokenFetch(),
      checkApiHealth(),
      checkCacheDir(),
      checkMcpServer(),
      checkTelemetry(),
    ]);
    const checks: CheckResult[] = [nodeV, configF, authC, tokenC, ...apiCs, cacheC, mcpC, telC];

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
