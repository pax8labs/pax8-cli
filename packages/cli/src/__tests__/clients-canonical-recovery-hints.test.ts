// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectFailure } from "./test-utils.js";

/**
 * #522 regression guard: error-recovery hints across the resolve-company
 * fan-in must point users (and agents) at `pax8 clients list` — the
 * canonical surface — not the deprecated `pax8 companies list` alias.
 *
 * Before #522 only `clients more` used the new vocabulary; every other path
 * that called through `resolveCompany` printed `pax8 companies list` on
 * failure, bouncing the user back to a deprecated verb at exactly the
 * moment they were already stuck.
 *
 * We exercise three of the surveyed paths end-to-end against the demo
 * client so the assertion catches regressions in the shared hint source
 * (`packages/cli/src/lib/resolve-company.ts`) as well as any future
 * command that grows a local recovery hint and forgets to migrate.
 */
describe("recovery hints use canonical 'pax8 clients list' vocabulary (#522)", () => {
  const NONEXISTENT = "DefinitelyNotARealCustomerXYZ";

  it("clients show <unresolvable> recovers via `pax8 clients list`", async () => {
    const result = await runCliExpectFailure([
      "clients",
      "show",
      NONEXISTENT,
    ]);
    expect(result.stderr).toContain("pax8 clients list");
    expect(result.stderr).not.toContain("pax8 companies list");
  });

  it("subscriptions list --company <unresolvable> recovers via `pax8 clients list`", async () => {
    const result = await runCliExpectFailure([
      "subscriptions",
      "list",
      "--company",
      NONEXISTENT,
    ]);
    expect(result.stderr).toContain("pax8 clients list");
    expect(result.stderr).not.toContain("pax8 companies list");
  });

  it("cost sim --company <unresolvable> recovers via `pax8 clients list`", async () => {
    const result = await runCliExpectFailure([
      "cost",
      "sim",
      "--company",
      NONEXISTENT,
      "--product",
      "Microsoft 365 Business Standard",
      "--quantity",
      "1",
    ]);
    expect(result.stderr).toContain("pax8 clients list");
    expect(result.stderr).not.toContain("pax8 companies list");
  });

  it("clients more --help references `from clients list` (not `companies list`)", async () => {
    // --help exits 0, so use runCli directly via expectFailure's sibling.
    // Easiest: invoke clients more with --help and inspect stdout. Reuse
    // a small spawn via runCliExpectFailure on a malformed invocation
    // would be wrong here — fall back to a direct spawn.
    const { runCli } = await import("./test-utils.js");
    const result = await runCli(["clients", "more", "--help"]);
    expect(result.exitCode).toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("from clients list");
    expect(combined).not.toContain("from companies list");
  });
});
