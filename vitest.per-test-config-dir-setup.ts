// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest setupFile: gives **each test** its own `PAX8_CONFIG_DIR` mkdtemp.
 *
 * Closes Variant B of #620 — the orders-fixture-file shared-state flake.
 *
 * Why this is per-test, not per-file or per-run:
 *
 * - The globalSetup in `vitest.test-isolation-setup.ts` already provides a
 *   single mkdtemp for the whole vitest run. That covers "the developer's
 *   local `~/.pax8/` shouldn't leak in" but DOESN'T cover the case where
 *   two test files (or two parallel workers) mutate the same shared file.
 *   `MockPax8Client.OrdersResource` persists created orders to
 *   `${PAX8_CONFIG_DIR}/demo-orders.json`. Test A's `orders create` can
 *   shift Test B's `orders list` totals mid-call. That's exactly the
 *   pattern that produced #620's pagination flake.
 *
 * - Per-FILE isolation (one mkdtemp per test file) would still let
 *   concurrent `it()` blocks in the same file race — vitest's default
 *   pool runs files serially per worker but tests within a file can
 *   interleave at I/O boundaries when async.
 *
 * - Per-TEST isolation gives every `it()` block its own clean slate.
 *   Multiple `runCli()` calls inside ONE test still share state (the
 *   legitimate "create then list" pattern) because they happen within
 *   the same beforeEach/afterEach scope.
 *
 * Implementation: registers global beforeEach + afterEach hooks. These
 * apply to every test in every file in this worker. The mutated
 * `process.env.PAX8_CONFIG_DIR` is inherited by every subprocess
 * spawned via `execFile`/`spawn` in `runCli` (`__tests__/test-utils.ts`)
 * since that helper passes `{ ...process.env, ... }`.
 *
 * Tests that explicitly set `PAX8_CONFIG_DIR` via `runCli({ PAX8_CONFIG_DIR: ... })`
 * still take precedence — the `finalEnv` spread in `runCli` runs last.
 * Likewise, tests that mutate `process.env.PAX8_CONFIG_DIR` in their own
 * beforeAll/beforeEach take precedence within their scope and we restore
 * the previous value afterward so an earlier-set ad-hoc dir survives
 * untouched after this hook's afterEach fires.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach } from "vitest";

// Module-load-time snapshot of the globalSetup-provided baseline. This
// runs once per worker, after `vitest.test-isolation-setup.ts` has run
// in the parent and the worker has inherited the env, but before any
// test's beforeAll / beforeEach has executed. If a later test mutates
// `process.env.PAX8_CONFIG_DIR` to point at its own tmpdir (the
// existing pattern in errors.test.ts, report-bug.test.ts, etc.), our
// beforeEach detects that — the current value no longer matches the
// baseline — and stands aside. Those tests get the dir they set; we
// don't clobber it.
const BASELINE_CONFIG_DIR = process.env.PAX8_CONFIG_DIR;

let savedConfigDir: string | undefined;
let currentTestDir: string | undefined;

beforeEach(() => {
  savedConfigDir = process.env.PAX8_CONFIG_DIR;
  // Only mint a fresh per-test dir when no test-level override is
  // currently active. The "active override" signal is "current value
  // differs from the globalSetup baseline" — i.e. some beforeAll or
  // outer hook set it explicitly. Respecting that preserves the
  // beforeAll/beforeEach-based isolation patterns existing tests
  // already use, while still giving the (much larger) population of
  // tests that DON'T set PAX8_CONFIG_DIR per-test isolation for free.
  if (process.env.PAX8_CONFIG_DIR === BASELINE_CONFIG_DIR) {
    currentTestDir = mkdtempSync(join(tmpdir(), "pax8-test-"));
    process.env.PAX8_CONFIG_DIR = currentTestDir;
  } else {
    currentTestDir = undefined;
  }
});

afterEach(() => {
  if (currentTestDir) {
    try {
      rmSync(currentTestDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; tmpdir gets reaped by the OS anyway.
    }
    currentTestDir = undefined;
  }
  // Restore the prior value rather than clobbering — preserves
  // whatever the globalSetup or a per-test override had set.
  if (savedConfigDir === undefined) {
    delete process.env.PAX8_CONFIG_DIR;
  } else {
    process.env.PAX8_CONFIG_DIR = savedConfigDir;
  }
  savedConfigDir = undefined;
});
