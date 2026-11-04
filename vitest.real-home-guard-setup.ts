// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest globalSetup: fails the test run if the suite creates or mutates
 * a real local-state directory the CLI can write — `~/.pax8`, and (since
 * #720) `~/.claude/skills/pax8`.
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
 *   - Snapshot each watched directory (exists / ctime / mtime / inode) at setup.
 *   - At teardown, compare. Any of these fails the run:
 *       1. The directory did not exist before but exists after.
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
 *
 * `~/.claude/skills/pax8` is watched rather than all of `~/.claude`:
 * Claude Code writes throughout its own config dir continuously (a
 * contributor may well be running it while the suite runs), so the wider
 * directory would flag on someone else's activity. The skill directory is
 * written by exactly one thing — `pax8 skill install --global` — which
 * makes it a precise tripwire for the leak we care about.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { statSync, existsSync, readdirSync } from "node:fs";

interface FileEntry {
  name: string;
  mtimeMs: number;
}

interface WatchedDir {
  /** Absolute path to watch. */
  path: string;
  /** How a test is supposed to redirect writes away from it. */
  isolationHint: string;
}

const WATCHED: WatchedDir[] = [
  {
    path: join(homedir(), ".pax8"),
    isolationHint: "Tests must set PAX8_CONFIG_DIR to a tmpdir (or stub os.homedir()).",
  },
  {
    path: join(homedir(), ".claude", "skills", "pax8"),
    isolationHint:
      "Tests must set CLAUDE_CONFIG_DIR to a tmpdir — vitest.test-isolation-setup.ts does this for the whole run.",
  },
];

interface HomeSnapshot {
  path: string;
  isolationHint: string;
  existedBefore: boolean;
  inode?: number;
  mtimeMs?: number;
  ctimeMs?: number;
  /**
   * Top-level entries inside the watched directory (file or dir name +
   * mtime). Used at teardown to point at *which* files appeared or
   * changed — without this, the guard says "isolation broken" but can't
   * name the offending test.
   */
  entries: FileEntry[];
}

function listEntries(p: string): FileEntry[] {
  try {
    return readdirSync(p, { withFileTypes: true }).map((e) => {
      try {
        const s = statSync(join(p, e.name));
        return { name: e.name, mtimeMs: s.mtimeMs };
      } catch {
        return { name: e.name, mtimeMs: 0 };
      }
    });
  } catch {
    return [];
  }
}

function snapshot({ path: p, isolationHint }: WatchedDir): HomeSnapshot {
  if (!existsSync(p)) {
    return { path: p, isolationHint, existedBefore: false, entries: [] };
  }
  try {
    const s = statSync(p);
    return {
      path: p,
      isolationHint,
      existedBefore: true,
      inode: s.ino,
      mtimeMs: s.mtimeMs,
      ctimeMs: s.ctimeMs,
      entries: listEntries(p),
    };
  } catch {
    return { path: p, isolationHint, existedBefore: false, entries: [] };
  }
}

function compare(before: HomeSnapshot, after: HomeSnapshot): string[] {
  const violations: string[] = [];

  if (!before.existedBefore && after.existedBefore) {
    const appearedFiles =
      after.entries.length > 0
        ? after.entries.map((e) => e.name).sort().join(", ")
        : "(directory only — no files)";
    violations.push(
      `Tests created ${after.path} — a real user state directory. ` +
        `${after.isolationHint} ` +
        `Files that appeared: ${appearedFiles}`,
    );
  } else if (before.existedBefore && after.existedBefore) {
    if (before.inode !== after.inode) {
      violations.push(
        `Tests recreated ${after.path} (inode ${before.inode} -> ${after.inode}). ` +
          `Something rm'd and re-mkdir'd the real directory. ${after.isolationHint}`,
      );
    }
    if (
      before.mtimeMs !== undefined &&
      after.mtimeMs !== undefined &&
      after.mtimeMs > before.mtimeMs
    ) {
      // Diff entries to name the offending files — much more useful than
      // a bare mtime delta when the suite spans hundreds of tests.
      const beforeByName = new Map(before.entries.map((e) => [e.name, e.mtimeMs]));
      const added = after.entries
        .filter((e) => !beforeByName.has(e.name))
        .map((e) => e.name);
      const modified = after.entries
        .filter((e) => {
          const prev = beforeByName.get(e.name);
          return prev !== undefined && e.mtimeMs > prev;
        })
        .map((e) => e.name);
      const removed = before.entries
        .filter((e) => !after.entries.some((a) => a.name === e.name))
        .map((e) => e.name);
      const detail = [
        added.length ? `added: ${added.sort().join(", ")}` : "",
        modified.length ? `modified: ${modified.sort().join(", ")}` : "",
        removed.length ? `removed: ${removed.sort().join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      violations.push(
        `Tests modified the contents of ${after.path} ` +
          `(mtime ${new Date(before.mtimeMs).toISOString()} -> ` +
          `${new Date(after.mtimeMs).toISOString()}). ` +
          `A test wrote into a real user state directory. ${after.isolationHint}` +
          (detail ? ` Changes: ${detail}` : ""),
      );
    }
  }

  return violations;
}

export default function setup(): () => void {
  const before = WATCHED.map(snapshot);
  return () => {
    const violations = before.flatMap((b, i) => compare(b, snapshot(WATCHED[i])));

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
