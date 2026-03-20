import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

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
