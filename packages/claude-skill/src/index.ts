import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

interface CliError {
  error: string;
  recovery: string;
}

function classifyError(stderr: string, code: number | null): CliError {
  const msg = stderr.trim();

  if (/auth|token|unauthorized|401|credentials/i.test(msg)) {
    return { error: "Auth token expired or invalid", recovery: "Run pax8 auth login" };
  }
  if (/rate.?limit|429|too many requests|throttl/i.test(msg)) {
    return { error: "Rate limit exceeded", recovery: "Wait and retry" };
  }
  if (/not found|404|no .* found|does not exist/i.test(msg)) {
    return { error: "Resource not found", recovery: "Check the ID and try again" };
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|socket|EAI_AGAIN|fetch failed/i.test(msg)) {
    return { error: "Network error", recovery: "Check connectivity, run pax8 doctor" };
  }
  if (/timeout/i.test(msg)) {
    return { error: "Request timed out", recovery: "Check connectivity, run pax8 doctor" };
  }

  return {
    error: msg || `CLI exited with code ${code ?? "unknown"}`,
    recovery: "Run pax8 doctor to diagnose the issue",
  };
}

export async function execCli(args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("pax8", args, { timeout: 30000 });
    return stdout;
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; code?: number | null; killed?: boolean; message?: string };

    if (execErr.killed) {
      return JSON.stringify({
        error: "Command timed out after 30 seconds",
        recovery: "The API may be slow — try again or run pax8 doctor",
      });
    }

    const stderr = execErr.stderr ?? execErr.message ?? "Unknown error";
    const code = execErr.code ?? null;
    return JSON.stringify(classifyError(stderr, code));
  }
}

export * from "./tools/index.js";
