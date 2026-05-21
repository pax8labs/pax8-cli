// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

describe("E2E: Error handling", () => {
  it("pax8 nonexistent-command exits with error", async () => {
    const result = await runCli(["nonexistent-command"]);
    // Commander exits with non-zero or writes error to stderr
    const hasError =
      result.exitCode !== 0 ||
      result.stderr.length > 0 ||
      result.stdout.includes("error");
    expect(hasError).toBe(true);
  });

  it("pax8 --help shows help text with command groups", async () => {
    const result = await runCliExpectSuccess(["--help"]);
    expect(result.stdout).toContain("pax8");
    expect(result.stdout).toContain("clients");
    expect(result.stdout).toContain("subscriptions");
    expect(result.stdout).toContain("products");
    expect(result.stdout).toContain("invoices");
    expect(result.stdout).toContain("auth");
  });

  it("pax8 clients --help shows companies subcommands", async () => {
    const result = await runCliExpectSuccess(["clients", "--help"]);
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("clients");
  });
});
