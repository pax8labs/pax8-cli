// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Repo-wide policy gate for local-state writes (#458 / #469).
 *
 * Two rules:
 *
 *   1. Command and command-helper code under `packages/cli/src/` must never
 *      call `os.homedir()` directly. All path resolution for CLI-owned
 *      state goes through `getConfigDir()`, which honors `PAX8_CONFIG_DIR`.
 *      An exception list below covers files that have a documented reason
 *      (e.g. core internals snapshotting the home at module load).
 *
 *   2. CLI code that writes JSON state files goes through
 *      `safeWriteFileSync` (mode 0o600, O_NOFOLLOW). A grep heuristic
 *      flags raw `writeFileSync(...)` and `fs.writeFile(...)` calls in
 *      `packages/cli/src/` outside the exception list; if you have a
 *      legitimate reason (e.g. config YAML written via `loader.saveConfig`
 *      in core), add the file to ALLOWED_RAW_WRITERS with a comment.
 *
 * This is intentionally a string-search regression test — fast, deterministic,
 * and PR-reviewable. A future static-analysis pass could replace it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

// Resolve the repo root by walking up from this test file. We can't rely
// on `process.cwd()` because vitest can be invoked from a subdirectory.
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

/**
 * Files under `packages/cli/src/` that are allowed to call `os.homedir()`
 * directly. Keep this list short and comment each entry.
 */
const HOMEDIR_EXCEPTIONS = new Set<string>([
  // Test fixtures that legitimately need to reference the real home dir
  // for assertions (e.g. doctor-style "is the user's config readable?").
  "packages/cli/src/__tests__/security.test.ts",
  // This file — the regression test itself doesn't call homedir(), but
  // it references the string in comments, so the grep would false-flag.
  "packages/cli/src/__tests__/local-state-writers.test.ts",
  // M-5 home-dir-guard tests: need to create a tmpdir *inside* $HOME so
  // the subprocess validates PAX8_CONFIG_DIR=under-home and only the
  // per-feature *_DIR env trips the guard. mkdtemp+rm cleanup means no
  // leftover state.
  "packages/cli/src/__tests__/idempotency.test.ts",
]);

/**
 * Files under `packages/core/src/` that are allowed to call `os.homedir()`
 * directly. Core owns the canonical `~/.pax8` directory resolution (loader
 * and credential store), so it legitimately reads the home dir; the CLI is
 * the layer that must never bypass core. Keep this list short and comment
 * each entry. L-8 / #504 — adding core coverage to catch homedir leaks in
 * a future core service.
 */
const CORE_HOMEDIR_EXCEPTIONS = new Set<string>([
  // loader.ts: resolves the default `~/.pax8` config dir. This is the
  // canonical site — every other module routes through this loader.
  "packages/core/src/config/loader.ts",
  // credential-store.ts: writes ~/.pax8/credentials.json with O_NOFOLLOW
  // and mode 0o600. The home-dir reference is intrinsic to its job.
  "packages/core/src/auth/credential-store.ts",
  // validate-env.ts: implements the home-anchored path validator that
  // refuses to read credentials from outside $HOME. It MUST resolve the
  // real home dir to perform the comparison.
  "packages/core/src/security/validate-env.ts",
  // Test fixtures legitimately reference homedir() for assertions.
  "packages/core/src/auth/credential-store.test.ts",
  "packages/core/src/config/loader-extended.test.ts",
]);

/**
 * Files under `packages/core/src/` that are allowed to use raw
 * `writeFileSync` / `fs.writeFile`. Core owns the lower-level write paths
 * (config YAML, on-disk cache) and uses explicit `mode: 0o600`. The CLI is
 * the layer that must funnel through `safeWriteFileSync`.
 */
const CORE_ALLOWED_RAW_WRITERS = new Set<string>([
  // loader.ts: writes the user-edited config.yaml with mode 0o600. Async
  // fs.writeFile is the canonical surface; not state-file-shaped.
  "packages/core/src/config/loader.ts",
  // cache.ts: writes a tmp file with mode 0o600 then renames atomically.
  // The rename step doesn't need O_NOFOLLOW (rename doesn't follow links).
  "packages/core/src/services/cache.ts",
  // Tests legitimately write fixtures into tmpdirs.
  "packages/core/src/config/loader-extended.test.ts",
  "packages/core/src/config/loader.test.ts",
  "packages/core/src/telemetry/telemetry.test.ts",
]);

/**
 * Files under `packages/cli/src/` that are allowed to use raw
 * `writeFileSync` / `fs.writeFile`. Document each entry.
 */
const ALLOWED_RAW_WRITERS = new Set<string>([
  // Idempotency cache: writes tmp file then renames. The tmp write goes
  // through safeWriteFileSync; the rename uses fs.rename which doesn't
  // need O_NOFOLLOW (rename is atomic and doesn't follow links).
  "packages/cli/src/lib/idempotency.ts",
  // Dispute drafts: same tmp + rename pattern, tmp write via safeWriteFileSync.
  "packages/cli/src/commands/invoices/dispute.ts",
  // last-list.ts: routed through safeWriteFileSync (#469).
  "packages/cli/src/lib/last-list.ts",
  // config init/set: writes config.yaml via async fs.writeFile with mode 0o600.
  // Distinct from state-file writes — these are user-edited config and the
  // YAML formatting flow doesn't fit the binary buffer shape of safeWriteFileSync.
  // Out of scope for #458/#469; tracked separately if hardened later.
  "packages/cli/src/commands/config/init.ts",
  "packages/cli/src/commands/config/set.ts",
  // errors.ts: last-error envelope is already routed through safeWriteFileSync
  // (see grep — the file references it). The match here is a comment string.
  "packages/cli/src/lib/errors.ts",
  // doctor.ts: probes cache-dir writability with a write+unlink. Not a
  // state file — the test marker is deleted immediately. Routed through
  // getConfigDir() already.
  "packages/cli/src/commands/doctor.ts",
]);

function listMatchingFiles(pattern: string, paths: string[]): string[] {
  // `git grep -l` is fast and respects .gitignore. The grep is run from
  // the repo root so paths in the output are repo-relative — which is
  // the form we want for the exception sets.
  //
  // Use execFileSync (no shell) instead of execSync (with shell). On
  // Windows cmd.exe, the shell mangles regex backslash escapes inside
  // single-quoted patterns (cmd.exe doesn't honor POSIX single quoting),
  // so a regex like `fs\.writeFile\(` becomes `fs.writeFile(` minus the
  // escapes — or worse, the parser treats `\` as an escape character and
  // truncates the pattern. execFileSync passes argv straight to git, no
  // shell parsing, identical behavior across platforms.
  try {
    const out = execFileSync(
      "git",
      ["grep", "-l", "--extended-regexp", pattern, "--", ...paths],
      { cwd: REPO_ROOT, encoding: "utf-8" },
    );
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (err: unknown) {
    // `git grep -l` exits 1 when nothing matches. Treat that as "no
    // violations" rather than a test infrastructure failure.
    const e = err as { status?: number; stderr?: Buffer | string };
    if (e.status === 1) return [];
    const stderr = e.stderr ? e.stderr.toString() : "";
    throw new Error(`git grep failed: ${stderr}`, { cause: err });
  }
}

describe("local-state writer policy (#458 / #469)", () => {
  it("CLI command code does not call os.homedir() directly", () => {
    // Match `homedir()` and `os.homedir()` and the dynamic-import form
    // (`const { homedir } = await import("os")`). The third pattern is
    // the one that bit us in #469 — the lazy import dodges a naive
    // top-level grep.
    const violators = listMatchingFiles(
      "homedir\\(\\)|from .node:os.|from .os.|require\\(.os.\\)|require\\(.node:os.\\)",
      ["packages/cli/src"],
    )
      // Only keep files that actually call homedir() — the import filter
      // alone catches imports for unrelated reasons (e.g. tmpdir()).
      .filter((f) => {
        const text = readFileSync(join(REPO_ROOT, f), "utf-8");
        return /\bhomedir\s*\(/.test(text);
      })
      .filter((f) => !HOMEDIR_EXCEPTIONS.has(f));

    expect(violators, "CLI files calling os.homedir() outside the exception list").toEqual([]);
  });

  it("CLI state-file writers go through safeWriteFileSync", () => {
    // `writeFileSync(` is the sync form; `fs.writeFile(` and
    // `await fs.writeFile(` are async forms. Both can drop a file at
    // a path without O_NOFOLLOW / 0o600 unless wrapped.
    const violators = listMatchingFiles(
      "writeFileSync\\(|fs\\.writeFile\\(",
      ["packages/cli/src"],
    )
      // Exclude tests — they're allowed to write fixtures into tmpdirs.
      .filter((f) => !f.includes("/__tests__/") && !f.endsWith(".test.ts"))
      .filter((f) => !ALLOWED_RAW_WRITERS.has(f));

    expect(
      violators,
      "CLI files writing local state without safeWriteFileSync (add to ALLOWED_RAW_WRITERS if intentional)",
    ).toEqual([]);
  });

  // L-8 / #504 — extend the same shape to packages/core/src so a future
  // core service introducing a homedir-resolving or raw-writeFile leak is
  // caught at PR time. Core legitimately owns the canonical ~/.pax8 paths,
  // so the exception lists are explicit (see CORE_HOMEDIR_EXCEPTIONS /
  // CORE_ALLOWED_RAW_WRITERS at the top of this file).
  it("core code does not call os.homedir() outside the documented exception list", () => {
    const violators = listMatchingFiles(
      "homedir\\(\\)|from .node:os.|from .os.|require\\(.os.\\)|require\\(.node:os.\\)",
      ["packages/core/src"],
    )
      .filter((f) => {
        const text = readFileSync(join(REPO_ROOT, f), "utf-8");
        return /\bhomedir\s*\(/.test(text);
      })
      .filter((f) => !CORE_HOMEDIR_EXCEPTIONS.has(f));

    expect(
      violators,
      "core files calling os.homedir() outside the exception list (add to CORE_HOMEDIR_EXCEPTIONS with a comment if intentional)",
    ).toEqual([]);
  });

  it("core state-file writers route through documented sites", () => {
    const violators = listMatchingFiles(
      "writeFileSync\\(|fs\\.writeFile\\(",
      ["packages/core/src"],
    )
      .filter((f) => !CORE_ALLOWED_RAW_WRITERS.has(f));

    expect(
      violators,
      "core files writing without going through a documented write site (add to CORE_ALLOWED_RAW_WRITERS if intentional)",
    ).toEqual([]);
  });
});
