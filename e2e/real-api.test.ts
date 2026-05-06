import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI_PATH = resolve(__dirname, "../packages/cli/dist/index.js");

const hasCredentials =
  !!process.env.PAX8_CLIENT_ID && !!process.env.PAX8_CLIENT_SECRET;

const describeReal = hasCredentials ? describe : describe.skip;

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runReal(args: string[]): Promise<CliResult> {
  try {
    const result = await exec("node", [CLI_PATH, ...args], {
      env: { ...process.env, NO_COLOR: "1" },
      timeout: 30_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: error.code ?? 1,
    };
  }
}

async function runRealExpectSuccess(args: string[]): Promise<CliResult> {
  const result = await runReal(args);
  if (result.exitCode !== 0) {
    throw new Error(
      `Expected CLI to succeed but got exit code ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
  return result;
}

describeReal("Real API integration tests", () => {
  it(
    "auth status returns valid token info",
    async () => {
      const result = await runRealExpectSuccess(["auth", "status"]);
      // Should mention token or authenticated status
      expect(result.stdout + result.stderr).toBeTruthy();
    },
    30_000
  );

  it(
    "companies list --json returns valid company objects",
    async () => {
      const result = await runRealExpectSuccess(["companies", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      const company = data[0];
      expect(company).toHaveProperty("id");
      expect(company).toHaveProperty("name");
      expect(typeof company.id).toBe("string");
      expect(typeof company.name).toBe("string");
    },
    30_000
  );

  it(
    "subscriptions list --json --size 10 returns valid subscriptions",
    async () => {
      const result = await runRealExpectSuccess([
        "subscriptions",
        "list",
        "--json",
        "--size",
        "10",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      const sub = data[0];
      expect(sub).toHaveProperty("id");
      expect(sub).toHaveProperty("productId");
      expect(sub).toHaveProperty("companyId");
      expect(typeof sub.id).toBe("string");
    },
    30_000
  );

  it(
    'products search "Microsoft" --json returns products',
    async () => {
      const result = await runRealExpectSuccess([
        "products",
        "search",
        "Microsoft",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      const product = data[0];
      expect(product).toHaveProperty("id");
      expect(product).toHaveProperty("name");
      expect(typeof product.name).toBe("string");
    },
    30_000
  );

  it(
    "invoices list --json returns invoices array",
    async () => {
      const result = await runRealExpectSuccess(["invoices", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      // May be empty but must be a valid array
      expect(Array.isArray(data)).toBe(true);
      if (data.length > 0) {
        expect(data[0]).toHaveProperty("id");
      }
    },
    30_000
  );

  it(
    "status --json returns dashboard data",
    async () => {
      const result = await runRealExpectSuccess(["status", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(data).toBeTruthy();
      expect(typeof data).toBe("object");
      // Status should have some known keys
      expect(data).toHaveProperty("totalCompanies");
      expect(data).toHaveProperty("activeSubscriptions");
    },
    30_000
  );

  it(
    "subscriptions renewals --json returns renewals structure",
    async () => {
      const result = await runRealExpectSuccess([
        "subscriptions",
        "renewals",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      // May be an array or an object with renewals
      expect(data).toBeTruthy();
      if (Array.isArray(data)) {
        // Each renewal should have subscription-like properties if non-empty
        if (data.length > 0) {
          expect(data[0]).toHaveProperty("id");
        }
      } else {
        expect(typeof data).toBe("object");
      }
    },
    30_000
  );

  it(
    "recommendations list --json returns recommendations structure",
    async () => {
      const result = await runRealExpectSuccess([
        "recommendations",
        "list",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toBeTruthy();
      if (Array.isArray(data)) {
        if (data.length > 0) {
          expect(data[0]).toHaveProperty("id");
        }
      } else {
        expect(typeof data).toBe("object");
      }
    },
    30_000
  );
});
