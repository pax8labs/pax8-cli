// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);

const CLI_PATH = resolve(
  fileURLToPath(import.meta.url),
  "../../../dist/index.js"
);

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Per the H-5 contract, destructive commands refuse to proceed without
 * either an interactive TTY or `PAX8_CONFIRM_DESTRUCTIVE=<keyword>` in
 * env. Subprocess tests have neither by default, so unit tests of
 * destructive command *logic* (e.g. `subscriptions cancel` schedules
 * the right date) would all break on the gate that's not what they're
 * verifying. This map auto-injects the right keyword for known
 * destructive command paths so each test stays focused on its own
 * subject. The gate itself is verified in `confirm.test.ts` and the
 * integration test in `destructive-gate.test.ts`.
 *
 * When a test explicitly sets `PAX8_CONFIRM_DESTRUCTIVE`, that wins —
 * a test asserting the gate refuses with the wrong keyword still works.
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
  const finalEnv: Record<string, string> = {
    ...env,
    ...(autoKeyword !== undefined ? { PAX8_CONFIRM_DESTRUCTIVE: autoKeyword } : {}),
  };
  try {
    const result = await exec("node", [CLI_PATH, ...args], {
      env: { ...process.env, PAX8_DEMO: "1", NO_COLOR: "1", ...finalEnv },
      timeout: 15000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.code ?? 1,
    };
  }
}

/**
 * Run the CLI with the given string piped into stdin. Used to drive
 * interactive `confirm()` prompts from subprocess tests — execFile pipes
 * stdin but has no `input` option in the promisified form, so we drop to
 * spawn() for this one case.
 */
export async function runCliWithInput(
  args: string[],
  input: string,
  env?: Record<string, string>,
): Promise<CliResult> {
  return new Promise((resolveResult) => {
    const child = spawn("node", [CLI_PATH, ...args], {
      env: { ...process.env, PAX8_DEMO: "1", NO_COLOR: "1", ...env },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 15000);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolveResult({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.stdin.write(input);
    child.stdin.end();
  });
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
