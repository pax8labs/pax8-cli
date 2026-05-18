// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// End-to-end coverage for the REPL bug class that closed #226 (PR #227):
// typed-at-prompt commands spawned a child whose `node <path>` argv landed on
// a file that did not exist (`packages/cli/index.js` instead of
// `dist/index.js`), and every command crashed with MODULE_NOT_FOUND on global
// installs. The previous test surface only checked the resolveCliPath helper
// in isolation, never the actual spawn — so a regression would still ship
// invisibly. This test drives the prompt through stdin and asserts the child
// produces real command output without a module-resolution error.

const CLI_PATH = resolve(
  fileURLToPath(import.meta.url),
  "../../../dist/index.js",
);

interface ReplResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runRepl(stdin: string, timeoutMs = 15_000): Promise<ReplResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("node", [CLI_PATH], {
      env: {
        ...process.env,
        PAX8_REPL_FORCE: "1",
        PAX8_DEMO: "1",
        PAX8_QUIET: "1",
        NO_COLOR: "1",
        // The REPL exports FORCE_COLOR=1 to children; clear it so the
        // child's --json output isn't littered with ANSI escapes.
        FORCE_COLOR: "",
      },
      stdio: ["pipe", "pipe", "pipe"],
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
      reject(new Error(`REPL test timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolveResult({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

describe("REPL integration (prompt → child spawn)", () => {
  it("dispatches a typed command without MODULE_NOT_FOUND", async () => {
    const result = await runRepl("subscriptions list --json --size 1\nexit\n");

    // The regression we are guarding against: a child crash from a bad
    // process.argv[1]-derived spawn path. The crash surfaces as a
    // Node-level error on the child's inherited stderr.
    expect(result.stderr).not.toMatch(/MODULE_NOT_FOUND/i);
    expect(result.stderr).not.toMatch(/Cannot find module/i);
    expect(result.stderr).not.toMatch(/SyntaxError/i);

    // The command actually ran: the child reached the subscriptions command
    // and emitted at least one JSON object with a subscription shape.
    expect(result.stdout).toContain('"id":');
    expect(result.stdout).toContain('"companyId":');

    // REPL closed cleanly on `exit`.
    expect(result.exitCode).toBe(0);
  }, 20_000);
});
