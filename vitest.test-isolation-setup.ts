// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest globalSetup: isolates the test suite from the developer's local
 * `~/.pax8/` and `~/.claude/` directories.
 *
 * Without this, a developer who has run `pax8 config set demo true` (or
 * any other config write) gets unit-test failures that don't reproduce in
 * CI — `buildContext` reads the on-disk config and takes whatever path
 * the local config dictates, regardless of what the test set up. CI runs
 * on fresh runners so it never sees this; locally it's a paper-cut.
 *
 * Sets `PAX8_CONFIG_DIR` to a fresh mkdtemp directory before workers
 * spawn, then cleans up at teardown. Tests that need their own config
 * dir (existing pattern in several `__tests__/` files using `os.tmpdir()`)
 * still override `PAX8_CONFIG_DIR` for their own scope; they just no
 * longer have to worry about whatever the developer happens to have in
 * `~/.pax8/`.
 *
 * Pairs with the per-test mkdtemp `runCli` injection added by the e2e
 * harness (#216) — that handles subprocess isolation; this handles
 * unit-test isolation in the parent vitest process.
 *
 * `CLAUDE_CONFIG_DIR` gets the same treatment (#720). `pax8 skill install`
 * writes into Claude Code's directory and `pax8 doctor` reads it, so
 * without a redirect the suite would both depend on whatever the
 * developer happens to have installed globally and — worse — write into
 * it. Pointing it at a tmpdir makes "no skill installed" the deterministic
 * baseline; tests that want an installed copy set up their own.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let isolatedConfigDir: string | undefined;
let isolatedClaudeDir: string | undefined;

export default function setup(): () => void {
  isolatedConfigDir = mkdtempSync(join(tmpdir(), "pax8-vitest-config-"));
  process.env.PAX8_CONFIG_DIR = isolatedConfigDir;
  isolatedClaudeDir = mkdtempSync(join(tmpdir(), "pax8-vitest-claude-"));
  process.env.CLAUDE_CONFIG_DIR = isolatedClaudeDir;
  return () => {
    for (const dir of [isolatedConfigDir, isolatedClaudeDir]) {
      if (!dir) continue;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; tmpdir gets reaped by the OS anyway.
      }
    }
  };
}
