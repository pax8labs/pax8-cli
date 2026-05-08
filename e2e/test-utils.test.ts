// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// These tests cover the timeout-detection logic in `runCli` (test-utils.ts).
// `runCli` itself uses a fixed TIMEOUT_MS (30s) so we can't drive a real
// timeout through it cheaply — instead we mirror its catch-block logic
// against a deliberately short-timeout `execFile` call, asserting the same
// observable contract: a SIGTERM-killed child surfaces as exitCode === -1
// with a "(timed out after Xms)" suffix on stderr, NOT exitCode === 1
// (which would be indistinguishable from a real failure).

interface MirroredResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

async function runWithTimeout(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<MirroredResult> {
  try {
    const result = await exec(cmd, args, { timeout: timeoutMs });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: any) {
    const timedOut = error.killed === true && error.signal === "SIGTERM";
    return {
      stdout: error.stdout ?? "",
      stderr: timedOut
        ? `${error.stderr ?? ""}\n(runCli timed out after ${timeoutMs}ms)`.trim()
        : (error.stderr ?? ""),
      exitCode: timedOut ? -1 : (error.code ?? 1),
      timedOut: timedOut || undefined,
    };
  }
}

describe("runCli timeout detection", () => {
  it("surfaces a hung child as exitCode -1 with a timed-out marker (not exit 1)", async () => {
    // Spawn a node process that intentionally never exits within the budget.
    // 200ms timeout against a 60s setTimeout — execFile will SIGTERM it.
    const result = await runWithTimeout(
      "node",
      ["-e", "setTimeout(() => {}, 60000)"],
      200
    );

    expect(result.exitCode).toBe(-1);
    expect(result.timedOut).toBe(true);
    expect(result.stderr).toContain("timed out after");
    expect(result.stderr).toContain("200ms");
  });

  it("preserves real exit codes for non-timeout failures", async () => {
    // process.exit(2) — completes well within the timeout budget, so the
    // catch block should NOT mark it as timed out and should pass through
    // the real exit code.
    const result = await runWithTimeout(
      "node",
      ["-e", "process.exit(2)"],
      30000
    );

    expect(result.exitCode).toBe(2);
    expect(result.timedOut).toBeUndefined();
    expect(result.stderr).not.toContain("timed out after");
  });
});
