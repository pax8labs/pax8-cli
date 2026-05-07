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

export async function runCli(
  args: string[],
  env?: Record<string, string>
): Promise<CliResult> {
  try {
    const result = await exec("node", [CLI_PATH, ...args], {
      env: { ...process.env, PAX8_DEMO: "1", NO_COLOR: "1", ...env },
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
