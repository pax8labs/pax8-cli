// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";

/**
 * Packaged-artifact smoke config (#697).
 *
 * Runs only `e2e/smoke/`. These tests install the CLI **as a consumer would**
 * — into a throwaway directory with no pnpm workspace above it — and run the
 * README demo commands against the resulting binary.
 *
 * Kept out of the default `pnpm test` run because:
 * - It needs the network (npm registry) and takes tens of seconds.
 * - It shells out to `npm`/`pnpm pack`, which CI should opt into explicitly.
 *
 * Why it exists at all: every other suite resolves `@pax8/core` through the
 * workspace symlink, so they all test the *source* core. A published `@pax8/cli`
 * resolves `@pax8/core` from the registry at the exact version that `pnpm
 * publish` baked in when it rewrote `workspace:*`. Those two can disagree —
 * that is precisely how 0.2.0 shipped calling a `@pax8/core` method the
 * published core did not have. Only an out-of-workspace install can catch it.
 *
 * Run with `pnpm test:smoke` (packs the local workspace; manual only) or
 * `PAX8_SMOKE_TARGET=registry pnpm test:smoke` (tests what is actually live).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["e2e/smoke/**/*.test.ts"],
    // `npm install` into a cold cache plus a build is the slow part; each
    // subsequent CLI invocation is fast.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    passWithNoTests: true,
    // One temp install shared by the file's tests — no cross-file parallelism.
    fileParallelism: false,
  },
});
