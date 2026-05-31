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

// #563 — companion harness that drives the REPL via the `tsx`-loaded
// TypeScript source instead of the built `dist/index.js`. Mirrors what
// CONTRIBUTING.md calls "the recommended dev workflow" (`pnpm dev`).
//
// Pre-fix, every typed command in this mode crashed the child with
// ERR_MODULE_NOT_FOUND because `repl.ts:235` hardcoded `spawn("node",
// ...)`. `node` can't resolve `.ts` files, so the dispatch crashed
// before the child even reached the command's handler. The masking
// effect: contributors ran `pnpm dev`, saw the REPL banner, typed any
// command, hit the crash, never built confidence that local changes
// worked — and the test suite ran only against `dist/`, so regressions
// like #561 (bare-number drill-in dead) shipped invisibly past CI.
//
// The fix detects a `.ts` entrypoint and registers tsx via Node's
// `--import` hook for child spawns. This harness is the regression
// guard that pins the contract: dev-mode REPL must dispatch typed
// commands as cleanly as production-mode REPL.
const TS_ENTRYPOINT = resolve(
  fileURLToPath(import.meta.url),
  "../../index.ts",
);

// `tsx` is a workspace dependency installed under `packages/cli/node_modules`.
// `pnpm dev` works because the pnpm `--filter @pax8/cli dev` shim sets the
// CWD to `packages/cli` before exec'ing tsx, so `import "tsx/esm"` resolves
// against the right node_modules tree. Mirror that here so the test
// reproduces the documented dev workflow rather than testing some
// hypothetical alternate invocation.
const CLI_PKG_DIR = resolve(fileURLToPath(import.meta.url), "../../..");

function runReplViaTsx(stdin: string, timeoutMs = 30_000): Promise<ReplResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx/esm", TS_ENTRYPOINT],
      {
        cwd: CLI_PKG_DIR,
        env: {
          ...process.env,
          PAX8_REPL_FORCE: "1",
          PAX8_DEMO: "1",
          PAX8_QUIET: "1",
          NO_COLOR: "1",
          FORCE_COLOR: "",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

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
      reject(new Error(`tsx REPL test timed out after ${timeoutMs}ms`));
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

  // #563 regression guard: dev-mode REPL must dispatch typed commands
  // through the tsx loader without ERR_MODULE_NOT_FOUND. Same assertion
  // shape as the dist-path test above — the contract is identical
  // regardless of how the parent process was launched.
  it("(tsx dev mode) dispatches a typed command without ERR_MODULE_NOT_FOUND", async () => {
    const result = await runReplViaTsx(
      "subscriptions list --json --size 1\nexit\n",
    );

    expect(result.stderr).not.toMatch(/MODULE_NOT_FOUND/i);
    expect(result.stderr).not.toMatch(/Cannot find module/i);
    expect(result.stderr).not.toMatch(/SyntaxError/i);

    expect(result.stdout).toContain('"id":');
    expect(result.stdout).toContain('"companyId":');

    expect(result.exitCode).toBe(0);
  }, 45_000);

  // Regression guard for the pending-actions dispatch contract (#561):
  // writers must persist `command` strings prefixed with `pax8 ` so the
  // REPL dispatch regex at lib/repl.ts:191 (`/^pax8\s+\w/`, added in
  // #506 as defense-in-depth) matches and routes the bare-number input
  // to the drill-in command. Pre-fix, `clients list` and the #556
  // list-drill-in helper wrote `clients more <n>` / `<resource> show
  // <id>` without the prefix — dispatch silently fell through, `args`
  // stayed at `[<n>]`, and the child rejected it as `unknown command
  // '<n>'`.
  //
  // Verifying via piped stdin races: in non-TTY mode readline buffers
  // all input lines before the first spawned child writes
  // pending-actions, so the "1" handler reads a stale or empty file
  // regardless of the fix. That's a heredoc artifact, not a production
  // bug — interactive readline serializes events around `rl.pause()`.
  // The contract test below pins the write shape directly so a future
  // writer that drops the prefix gets caught even when the dispatch
  // path can't be exercised end-to-end from this harness.
  it("clients list persists pending-actions with the `pax8 ` prefix", async () => {
    const { spawn: spawnSync } = await import("node:child_process");
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const configDir = mkdtempSync(join(tmpdir(), "pax8-repl-contract-"));

    await new Promise<void>((resolveDone, rejectDone) => {
      const child = spawnSync(
        "node",
        [CLI_PATH, "clients", "list", "--size", "5", "--json"],
        {
          env: {
            ...process.env,
            PAX8_CONFIG_DIR: configDir,
            PAX8_DEMO: "1",
            PAX8_QUIET: "1",
            NO_COLOR: "1",
            FORCE_COLOR: "",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.on("close", (code) =>
        code === 0
          ? resolveDone()
          : rejectDone(new Error(`clients list exited ${code}`)),
      );
    });

    const raw = JSON.parse(
      readFileSync(join(configDir, "pending-actions.json"), "utf-8"),
    ) as { key: string; command: string }[];

    expect(raw.length).toBeGreaterThan(0);
    for (const entry of raw) {
      // The regex from lib/repl.ts:191 — kept verbatim so this test fails
      // on the same condition the production dispatch checks.
      expect(entry.command).toMatch(/^pax8\s+\w/);
    }
  }, 20_000);
});
