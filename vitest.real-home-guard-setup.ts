// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest globalSetup: fails the test run if the suite creates or mutates
 * the contributor's real `~/.pax8` config directory.
 *
 * Background (#475): on a fresh checkout, running `pnpm test` previously
 * created `~/.pax8` as a side effect of a unit test that exercised the
 * home-default code path. In sandboxed CI environments that don't have
 * `$HOME` write access this failed outright; on a contributor's machine
 * it leaked an empty `~/.pax8` directory.
 *
 * Companion to `vitest.test-isolation-setup.ts` (which redirects
 * PAX8_CONFIG_DIR to a tmpdir before workers fork). The isolation setup
 * prevents *normal* code paths from touching `~/.pax8`; this guard
 * catches tests that escape the default by clearing PAX8_CONFIG_DIR or
 * calling `os.homedir()` directly.
 *
 * Behavior:
 *   - Snapshot `~/.pax8` (exists / ctime / mtime / inode) at setup.
 *   - At teardown, compare. Any of these fails the run:
 *       1. `~/.pax8` did not exist before but exists after.
 *       2. The inode changed (directory was recreated).
 *       3. The directory mtime moved forward (contents added/removed).
 *   - The check is a `process.exitCode = 1` + stderr message rather than a
 *     thrown error so vitest's own teardown chain still completes (the
 *     isolated config dir from the sibling setup still gets cleaned up).
 *
 * This is intentionally observation-only: we don't try to write-protect
 * the real home dir (vitest workers fork, so chmod tricks don't compose).
 * The guarantee is "we'll loudly fail the run if anyone leaks". If
 * production code creates `~/.pax8` on `pax8 init` that's fine — only
 * the *test suite* is forbidden from touching it.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { statSync, existsSync } from "node:fs";

interface HomeSnapshot {
  path: string;
  existedBefore: boolean;
  inode?: number;
  mtimeMs?: number;
  ctimeMs?: number;
}

function snapshot(): HomeSnapshot {
  const p = join(homedir(), ".pax8");
  if (!existsSync(p)) {
    return { path: p, existedBefore: false };
  }
  try {
    const s = statSync(p);
    return {
      path: p,
      existedBefore: true,
      inode: s.ino,
      mtimeMs: s.mtimeMs,
      ctimeMs: s.ctimeMs,
    };
  } catch {
    return { path: p, existedBefore: false };
  }
}

export default function setup(): () => void {
  const before = snapshot();
  return () => {
    const after = snapshot();
    const violations: string[] = [];

    if (!before.existedBefore && after.existedBefore) {
      violations.push(
        `Tests created ${after.path} — the real user config directory. ` +
          `Tests must set PAX8_CONFIG_DIR to a tmpdir (or stub os.homedir()).`,
      );
    } else if (before.existedBefore && after.existedBefore) {
      if (before.inode !== after.inode) {
        violations.push(
          `Tests recreated ${after.path} (inode ${before.inode} -> ${after.inode}). ` +
            `Something rm'd and re-mkdir'd the real config directory.`,
        );
      }
      if (
        before.mtimeMs !== undefined &&
        after.mtimeMs !== undefined &&
        after.mtimeMs > before.mtimeMs
      ) {
        violations.push(
          `Tests modified the contents of ${after.path} ` +
            `(mtime ${new Date(before.mtimeMs).toISOString()} -> ` +
            `${new Date(after.mtimeMs).toISOString()}). ` +
            `A test wrote into the real config directory.`,
        );
      }
    }

    if (violations.length > 0) {
      process.stderr.write(
        "\n[vitest.real-home-guard-setup] FAIL — local-state isolation broken:\n",
      );
      for (const v of violations) {
        process.stderr.write(`  - ${v}\n`);
      }
      process.stderr.write(
        "\n  See vitest.real-home-guard-setup.ts and #475 for context.\n\n",
      );
      // Don't throw — let vitest finish its own teardown. The non-zero
      // exit code is what the CI/grep gate watches for.
      process.exitCode = 1;
    }
  };
}
