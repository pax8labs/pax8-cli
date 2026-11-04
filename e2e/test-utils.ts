// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as os from "node:os";

const exec = promisify(execFile);

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI_PATH = resolve(__dirname, "../packages/cli/dist/index.js");

// Hard upper bound for any single CLI invocation under runCli(). Bumped from
// 15s → 30s after #252 / #277 flakes on Windows-22: node cold-start + CLI init
// + Commander help under parallel test load can exceed 15s on slow runners.
// 30s is "did the help even start?" territory, not a perf budget — real
// commands return in well under a second under PAX8_DEMO=1.
const TIMEOUT_MS = 30000;

// Per-call isolated config dir. Without this, the e2e suite inherits the
// developer's `~/.pax8/last-error.json` — and tests within the same process
// also leak state to each other (a command that fails writes last-error.json
// which then changes report-bug's behavior on the next call). A fresh tmpdir
// per `runCli` call gives every command a clean slate, matching the unit
// suite's `makeTmpConfigDir` pattern.
function makeIsolatedConfigDir(): string {
  return fs.mkdtempSync(resolve(os.tmpdir(), "pax8-e2e-cfg-"));
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /**
   * True when the child process was killed by `execFile`'s timeout (SIGTERM
   * with `error.killed === true`). Distinguishes a hung-process flake from a
   * real exit-1 failure — same surface area, very different remediation.
   */
  timedOut?: boolean;
}

/**
 * H-5: destructive commands refuse to proceed without
 * `PAX8_CONFIRM_DESTRUCTIVE=<keyword>` in env on a non-TTY stdin
 * (subprocess tests are non-TTY by definition). E2E tests of
 * destructive *command logic* (e.g. `pax8 quotes delete` returns the
 * right JSON shape) would all break on the gate that's not what
 * they're verifying. This map auto-injects the right keyword for
 * known destructive command paths so each test stays focused on its
 * own subject. The gate itself is verified by
 * `packages/cli/src/__tests__/destructive-gate.test.ts`.
 *
 * When a test explicitly sets `PAX8_CONFIRM_DESTRUCTIVE`, that wins.
 */
const DESTRUCTIVE_KEYWORDS: Record<string, string> = {
  "subscriptions cancel": "cancel",
  "contacts delete": "delete",
  "quotes delete": "delete",
};

function autoConfirmDestructive(args: string[], env?: Record<string, string>): string | undefined {
  if (env?.PAX8_CONFIRM_DESTRUCTIVE !== undefined) return undefined;
  const positional = args.filter((a) => !a.startsWith("-")).slice(0, 2).join(" ");
  return DESTRUCTIVE_KEYWORDS[positional];
}

export async function runCli(
  args: string[],
  env?: Record<string, string>
): Promise<CliResult> {
  const autoKeyword = autoConfirmDestructive(args, env);
  try {
    const result = await exec("node", [CLI_PATH, ...args], {
      env: {
        ...process.env,
        PAX8_DEMO: "1",
        NO_COLOR: "1",
        PAX8_CONFIG_DIR: makeIsolatedConfigDir(),
        ...(autoKeyword !== undefined ? { PAX8_CONFIRM_DESTRUCTIVE: autoKeyword } : {}),
        ...env,
      },
      timeout: TIMEOUT_MS,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: any) {
    // execFile's timeout sends SIGTERM and sets killed=true; on those, the
    // child has no real exit code (error.code === null), which would
    // otherwise collapse to exitCode: 1 and be indistinguishable from a real
    // command failure. Surface it explicitly so callers (and the per-command
    // help test) can tell the two apart.
    const timedOut = error.killed === true && error.signal === "SIGTERM";
    return {
      stdout: error.stdout ?? "",
      stderr: timedOut
        ? `${error.stderr ?? ""}\n(runCli timed out after ${TIMEOUT_MS}ms)`.trim()
        : (error.stderr ?? ""),
      exitCode: timedOut ? -1 : (error.code ?? 1),
      timedOut: timedOut || undefined,
    };
  }
}

export async function runCliExpectSuccess(
  args: string[],
  env?: Record<string, string>
): Promise<CliResult> {
  const result = await runCli(args, env);
  if (result.exitCode !== 0) {
    throw new Error(
      `Expected CLI to succeed but got exit code ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
  return result;
}

export async function runCliExpectFailure(
  args: string[],
  env?: Record<string, string>
): Promise<CliResult> {
  const result = await runCli(args, env);
  if (result.exitCode === 0) {
    throw new Error(
      `Expected CLI to fail but got exit code 0\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
  return result;
}
