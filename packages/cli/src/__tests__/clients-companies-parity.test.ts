// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli } from "./test-utils.js";

/**
 * Regression guard for #317: `pax8 clients *` and `pax8 companies *` must
 * resolve to the same Commander command graph. We use Commander's native
 * `.alias()` mechanism in `packages/cli/src/commands/companies/index.ts`,
 * which structurally guarantees a single set of action handlers — the
 * tests below assert the *user-facing contract* (help output parity)
 * stays in sync so a future refactor can't silently introduce drift.
 */
describe("pax8 clients / pax8 companies parity (#317)", () => {
  // Subcommands that exist on the group today. If a new subcommand is added
  // to clients/companies/index.ts, add it here too so the parity contract
  // continues to hold.
  const SUBCOMMANDS = ["list", "show", "create", "update", "more"];

  /**
   * Strip leading "Usage:" line and any volatile text so we compare the
   * stable parts of `--help` output: options block, examples, etc.
   * The "Usage:" line legitimately differs (one says `clients`, the other
   * says `companies`), so we drop it.
   */
  function normalizeHelp(out: string): string {
    return out
      .split("\n")
      .filter((line) => !line.startsWith("Usage:"))
      .join("\n")
      .replace(/\bcompanies\b/g, "<GROUP>")
      .replace(/\bclients\b/g, "<GROUP>")
      .trim();
  }

  it("`pax8 clients --help` and `pax8 companies --help` describe the same subcommands", async () => {
    const clients = await runCli(["clients", "--help"]);
    const companies = await runCli(["companies", "--help"]);

    expect(clients.exitCode).toBe(0);
    expect(companies.exitCode).toBe(0);

    // Both should list every subcommand
    for (const sub of SUBCOMMANDS) {
      expect(clients.stdout, `clients --help missing ${sub}`).toMatch(
        new RegExp(`\\b${sub}\\b`),
      );
      expect(companies.stdout, `companies --help missing ${sub}`).toMatch(
        new RegExp(`\\b${sub}\\b`),
      );
    }
  });

  for (const sub of SUBCOMMANDS) {
    it(`\`pax8 clients ${sub} --help\` matches \`pax8 companies ${sub} --help\``, async () => {
      const clients = await runCli(["clients", sub, "--help"]);
      const companies = await runCli(["companies", sub, "--help"]);

      expect(clients.exitCode).toBe(0);
      expect(companies.exitCode).toBe(0);

      // The help output should be identical once the group-name token is
      // normalized — if a flag is added to one but not the other, this
      // assertion fails loudly.
      expect(normalizeHelp(clients.stdout)).toBe(normalizeHelp(companies.stdout));
    });
  }

  it("`pax8 --help` lists `clients` as the canonical command name", async () => {
    const top = await runCli(["--help"]);
    expect(top.exitCode).toBe(0);
    // Commander prints aliases as "clients|companies" or similar. Either way,
    // `clients` must appear as the canonical name.
    expect(top.stdout).toMatch(/\bclients\b/);
  });
});
