// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";

/**
 * Integration test config (#308).
 *
 * Runs only the wire-level smoke tests under `e2e/integration/`. These tests
 * hit the real Pax8 API using credentials from `PAX8_CLIENT_ID` /
 * `PAX8_CLIENT_SECRET` and skip cleanly when credentials are absent (see
 * `e2e/integration/harness.ts`).
 *
 * Kept separate from `vitest.config.ts` because:
 * - Default `pnpm test` must never depend on credentials (forks, local dev).
 * - Per-test timeouts are larger here — real network calls vs. mocked fetch.
 * - No coverage / no isolation-setup needed for this suite.
 *
 * Run with `pnpm test:integration`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["e2e/integration/**/*.test.ts"],
    env: {
      // Match the production-test escape hatch from vitest.config.ts so that
      // any helper that resolves PAX8_CONFIG_DIR doesn't reject a non-home
      // path (e.g. on hosted CI where $HOME is unusual).
      PAX8_ALLOW_NON_HOME_CONFIG: "1",
    },
    // No globalSetup — these tests don't need a temp config dir; they read
    // credentials directly from the environment. Per-test timeout is bumped
    // because real network round-trips can be slow.
    testTimeout: 60_000,
    hookTimeout: 30_000,
    passWithNoTests: true,
    // Run files serially — the real API has per-key rate limits and we don't
    // want to burn through them on a credential-less skip run, let alone a
    // real run. Cheap insurance against accidental concurrency.
    fileParallelism: false,
  },
});
