// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Sandbox integration test harness (#308).
 *
 * Hits the real Pax8 API using credentials from `PAX8_CLIENT_ID` /
 * `PAX8_CLIENT_SECRET`. Skips cleanly when credentials are absent so local
 * dev and credential-less CI both pass. Lives behind `pnpm test:integration`
 * and is excluded from the default `pnpm test` — coupling the default test
 * path to credentials would break forks and local-only contributors.
 *
 * # Why this exists
 *
 * The P0 bug in #307 (CLI quote calls resolving to `/v1/quotes` instead of
 * `/v2/quotes`) shipped because no test in the repo exercised a real wire
 * URL. Unit tests in `packages/core/src/api/*.test.ts` mock the client and
 * only assert on relative path strings. Subprocess tests in
 * `packages/cli/src/__tests__/` run with `PAX8_DEMO=1` against
 * `MockPax8Client` — no wire calls at all. Both layers sit below the wire,
 * so a version mismatch is invisible.
 *
 * This harness runs the built CLI with `--verbose` against the real API and
 * asserts that the resolved URL hits the version documented by the relevant
 * OpenAPI spec. If a future API class points at the wrong version segment,
 * a wire smoke test here will catch it before the partner does.
 *
 * # How to add a smoke test for a new API surface
 *
 * 1. Decide which version the resource lives at by checking
 *    `https://devx.pax8.com/openapi` for the relevant spec. Most resources
 *    live at `/v1` (`partner-endpoints.json`); quotes live at `/v2`
 *    (`quoting-endpoints.json`); webhooks live at `/api/v2`
 *    (`webhooks-endpoints.json`); etc.
 *
 * 2. Pick a single read-only command for the resource — `list` is usually
 *    the right shape (returns an array, exercises pagination, no required
 *    inputs). Reads only: writes against the real API are out of scope for
 *    this harness.
 *
 * 3. Add a `describe` block under `e2e/integration/`:
 *
 *    ```ts
 *    describeIntegration("widgets (v1)", () => {
 *      it("widgets list hits the documented v1 URL", async () => {
 *        const result = await runCliVerbose(["widgets", "list", "--json"]);
 *        expectExitZero(result);
 *        expectWireUrl(result, {
 *          method: "GET",
 *          pathContains: "/v1/widgets",
 *          version: "v1",
 *        });
 *      });
 *    });
 *    ```
 *
 *    `describeIntegration` skips cleanly when credentials are absent.
 *
 * 4. Keep each suite to **one read** per resource. The point is to catch
 *    structural regressions (wrong version segment, broken auth, wrong
 *    base URL) — not to re-test resource semantics, which subprocess tests
 *    already cover under `PAX8_DEMO=1`.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "vitest";

const exec = promisify(execFile);

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI_PATH = resolve(__dirname, "../../packages/cli/dist/index.js");

/** Does the environment have credentials for the real Pax8 API? */
export const HAS_CREDENTIALS =
  !!process.env.PAX8_CLIENT_ID && !!process.env.PAX8_CLIENT_SECRET;

// Surface the skip reason once per process so CI logs explain why every
// suite is grey, without spamming on each file's import. Cheap, file-scoped.
// Vitest forks a worker per file; the env-var marker propagates across
// imports within a worker but each fresh worker prints once, which is fine.
if (
  !HAS_CREDENTIALS &&
  !process.env.PAX8_INTEGRATION_QUIET &&
  !process.env.__PAX8_INTEGRATION_SKIP_LOGGED__
) {
  process.env.__PAX8_INTEGRATION_SKIP_LOGGED__ = "1";
  process.stderr.write(
    "[integration] PAX8_CLIENT_ID / PAX8_CLIENT_SECRET not set — skipping wire-level integration tests. " +
      "This is expected for forks, local dev, and credential-less CI runs.\n",
  );
}

/**
 * `describe`-style helper that skips the entire suite when credentials are
 * absent. Use this as the outer block for every integration test file:
 *
 *   describeIntegration("quotes (v2)", () => { ... });
 *
 * When `PAX8_CLIENT_ID` / `PAX8_CLIENT_SECRET` are unset, the suite is
 * registered with `describe.skip` so vitest exits 0 with a clean skip
 * message instead of a false failure.
 */
export const describeIntegration: typeof describe = HAS_CREDENTIALS
  ? describe
  : describe.skip;

// Per-worker temp config dir. Pax8Client's `FileCache` lives under
// `<configDir>/cache/` with a 1-hour default TTL — re-running an
// integration test within that window served a stale `[pax8] CACHE HIT`
// instead of issuing a fresh wire call, which then made `expectWireUrl`
// fail (no `[pax8] METHOD url=...` line was emitted on the cache hit
// path). Isolating each worker's cache + config to a throwaway dir
// guarantees every test exercises the wire and removes the
// cross-invocation flakiness.
//
// Vitest forks a worker per file; each worker gets its own dir and its
// own cleanup hook. No cross-worker contention.
const TEST_CONFIG_DIR = HAS_CREDENTIALS
  ? mkdtempSync(join(tmpdir(), "pax8-integration-"))
  : "";
if (TEST_CONFIG_DIR) {
  process.on("exit", () => {
    try {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    } catch {
      // best-effort; OS will reap /tmp eventually
    }
  });
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawn the built CLI with `--verbose` so `Pax8Client.request` emits the
 * resolved URL on stderr. `expectWireUrl` parses that line.
 *
 * Honors `PAX8_API_BASE` from the surrounding environment (e.g. sandbox
 * pointing at `https://api-staging.pax8.com/v1`) — we never set it here.
 */
export async function runCliVerbose(args: string[]): Promise<CliResult> {
  try {
    const result = await exec("node", [CLI_PATH, "--verbose", ...args], {
      env: {
        ...process.env,
        NO_COLOR: "1",
        // Force the real-API path. Without this, a developer with
        // `demo: true` in `~/.pax8/config.yaml` would silently exercise
        // `MockPax8Client` and the harness's wire assertions would all
        // skip — false-green. The presence of `PAX8_CLIENT_ID` /
        // `PAX8_CLIENT_SECRET` (which `describeIntegration` gates on) is
        // the integration-test signal; demo config in the dev environment
        // must not override that.
        PAX8_DEMO: "false",
        // Point at the per-worker throwaway config dir so every CLI
        // invocation starts with a fresh `FileCache`. Without this, a
        // previous test's response gets served from `~/.pax8/cache/`
        // (1-hour default TTL) on rerun and `expectWireUrl` fails
        // because cache hits don't emit the `[pax8] METHOD url=...`
        // line the assertion grep depends on.
        PAX8_CONFIG_DIR: TEST_CONFIG_DIR,
        PAX8_ALLOW_NON_HOME_CONFIG: "1",
      },
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
}

/** Assert the CLI exited 0; if not, surface stdout + stderr in the failure message. */
export function expectExitZero(result: CliResult): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `Expected CLI to exit 0 but got ${result.exitCode}.\n` +
        `--- stdout ---\n${result.stdout}\n` +
        `--- stderr ---\n${result.stderr}`,
    );
  }
}

export interface WireUrlExpectation {
  /** HTTP method the call should have used. */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /**
   * Substring the resolved URL's pathname must contain — e.g. `"/v2/quotes"`.
   * This is the load-bearing check: it catches wrong-version regressions like
   * the #307 quotes bug (`/v1/quotes` when the spec only documents `/v2/quotes`).
   */
  pathContains: string;
  /**
   * Optional separate assertion on the version segment. If set, every
   * matching call's URL must start with `<host>/<version>/...`. Mostly
   * documentation — `pathContains` already covers the regression class —
   * but useful for readability when the path substring doesn't pin version
   * unambiguously.
   */
  version?: string;
}

/**
 * Assert that the verbose-mode stderr trail contains at least one wire call
 * matching `expected`. Parses lines emitted by `Pax8Client.request` of the
 * form `[pax8] GET url=https://api.pax8.com/v2/quotes?page=0&size=50`.
 *
 * Throws a descriptive error if no matching call is observed, including the
 * full list of URLs the run actually hit. This is intentionally noisy on
 * failure: a wrong version segment is the exact class of bug we're catching.
 */
export function expectWireUrl(
  result: CliResult,
  expected: WireUrlExpectation,
): void {
  const calls = parseWireCalls(result.stderr);
  if (calls.length === 0) {
    throw new Error(
      "No `[pax8] <METHOD> url=<URL>` lines found on stderr. " +
        "Did you forget to pass `--verbose`? " +
        "Did the CLI exit before any wire call was made?\n" +
        `--- stderr ---\n${result.stderr}`,
    );
  }

  const match = calls.find((call) => {
    if (call.method !== expected.method) return false;
    if (!call.url.pathname.includes(expected.pathContains)) return false;
    if (expected.version) {
      const versionRe = new RegExp(`^/${expected.version}(/|$)`);
      if (!versionRe.test(call.url.pathname)) return false;
    }
    return true;
  });

  if (!match) {
    const observed = calls
      .map((c) => `  - ${c.method} ${c.url.toString()}`)
      .join("\n");
    const versionNote = expected.version
      ? ` and starts with /${expected.version}/`
      : "";
    throw new Error(
      `Expected at least one wire call where method=${expected.method} ` +
        `and pathname contains "${expected.pathContains}"${versionNote}, ` +
        `but observed:\n${observed}`,
    );
  }
}

interface WireCall {
  method: string;
  url: URL;
}

/**
 * Parse `[pax8] <METHOD> url=<URL>` lines emitted by `Pax8Client` when
 * `debug` is on. Lines without a parseable URL (or any other stderr noise:
 * spinners, banners, ANSI) are silently skipped — this is a tolerant parser.
 */
function parseWireCalls(stderr: string): WireCall[] {
  const lineRe = /\[pax8\]\s+(GET|POST|PUT|PATCH|DELETE)\s+url=(\S+)/g;
  const calls: WireCall[] = [];
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(stderr)) !== null) {
    try {
      calls.push({ method: match[1]!, url: new URL(match[2]!) });
    } catch {
      // ignore malformed URLs — the parser is best-effort
    }
  }
  return calls;
}
