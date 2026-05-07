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
}

export async function runCli(
  args: string[],
  env?: Record<string, string>
): Promise<CliResult> {
  try {
    const result = await exec("node", [CLI_PATH, ...args], {
      env: {
        ...process.env,
        PAX8_DEMO: "1",
        NO_COLOR: "1",
        PAX8_CONFIG_DIR: makeIsolatedConfigDir(),
        ...env,
      },
      timeout: 15000,
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
