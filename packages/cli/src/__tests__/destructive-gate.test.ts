// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli } from "./test-utils.js";

/**
 * H-5 contract: a destructive command refuses to proceed when stdin
 * is not a TTY and `PAX8_CONFIRM_DESTRUCTIVE` is unset, even if
 * `--yes` / `PAX8_YES` is supplied. The pre-H-5 behavior was the
 * opposite — `--yes` silently bypassed the keyword challenge.
 *
 * These tests exercise the real subprocess so the gate's enforcement
 * across argv parsing + Commander + the action handler can't drift
 * back to "--yes is enough" without a regression caught here.
 *
 * The default `runCli` in test-utils.ts auto-injects
 * `PAX8_CONFIRM_DESTRUCTIVE` for destructive command paths so unit
 * tests of the underlying command logic don't get blocked. Each test
 * below explicitly *overrides* that injection to assert what happens
 * when the override is absent — i.e. the security contract holds.
 */
describe("destructive command gate (H-5)", () => {
  it("subscriptions cancel: --yes alone does not bypass the keyword challenge on non-TTY", async () => {
    const result = await runCli(
      [
        "subscriptions",
        "cancel",
        "sub-summit-m365bp-001",
        "--cancel-date",
        "2026-12-31",
        "--yes",
        "--json",
      ],
      // Empty string in env overrides the auto-injection so the gate
      // sees no override. The test asserts the refusal.
      { PAX8_CONFIRM_DESTRUCTIVE: "" },
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Destructive operation requires");
    expect(result.stderr).toContain("PAX8_CONFIRM_DESTRUCTIVE=cancel");
  });

  it("subscriptions cancel: PAX8_CONFIRM_DESTRUCTIVE=cancel satisfies the gate", async () => {
    const result = await runCli(
      [
        "subscriptions",
        "cancel",
        "sub-summit-m365bp-001",
        "--cancel-date",
        "2026-12-31",
        "--yes",
        "--json",
      ],
      { PAX8_CONFIRM_DESTRUCTIVE: "cancel" },
    );
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data[0]).toMatchObject({
      id: "sub-summit-m365bp-001",
      status: "Cancelled",
      cancelDate: "2026-12-31",
    });
  });

  it("subscriptions cancel: PAX8_CONFIRM_DESTRUCTIVE with the WRONG keyword still refuses", async () => {
    const result = await runCli(
      [
        "subscriptions",
        "cancel",
        "sub-summit-m365bp-001",
        "--cancel-date",
        "2026-12-31",
        "--yes",
        "--json",
      ],
      { PAX8_CONFIRM_DESTRUCTIVE: "delete" }, // wrong keyword for cancel
    );
    // The command treats the wrong keyword as "not confirmed" and
    // skips the cancel. Exit is 0 (no error, just abandoned).
    expect(result.stdout).toBe("");
  });
});
