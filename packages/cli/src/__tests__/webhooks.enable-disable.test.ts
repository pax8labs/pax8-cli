// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import {
  runCli,
  runCliExpectSuccess,
  runCliExpectFailure,
} from "./test-utils.js";

const ACTIVE_WEBHOOK_ID = "11111111-2222-3333-4444-555555555501";
const DISABLED_WEBHOOK_ID = "11111111-2222-3333-4444-555555555503";

describe("pax8 webhooks disable", () => {
  it("disables an active webhook with --yes", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "disable",
      ACTIVE_WEBHOOK_ID,
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.id).toBe(ACTIVE_WEBHOOK_ID);
    expect(data.status).toBe("Disabled");
  });

  it("is idempotent on an already-disabled webhook (sets alreadyDisabled flag in JSON)", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "disable",
      DISABLED_WEBHOOK_ID,
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.id).toBe(DISABLED_WEBHOOK_ID);
    expect(data.status).toBe("Disabled");
    expect(data.alreadyDisabled).toBe(true);
  });

  it("fails on unknown id", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "disable",
      "00000000-0000-0000-0000-000000000000",
      "--yes",
    ]);
    expect(result.exitCode).not.toBe(0);
  });

  it("shows --help with examples", async () => {
    const result = await runCli(["webhooks", "disable", "--help"]);
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain("--yes");
  });
});

describe("pax8 webhooks enable", () => {
  it("enables a disabled webhook with --yes", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "enable",
      DISABLED_WEBHOOK_ID,
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.id).toBe(DISABLED_WEBHOOK_ID);
    expect(data.status).toBe("Active");
  });

  it("is idempotent on an already-active webhook (sets alreadyEnabled flag in JSON)", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "enable",
      ACTIVE_WEBHOOK_ID,
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.id).toBe(ACTIVE_WEBHOOK_ID);
    expect(data.status).toBe("Active");
    expect(data.alreadyEnabled).toBe(true);
  });

  it("fails on unknown id", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "enable",
      "00000000-0000-0000-0000-000000000000",
      "--yes",
    ]);
    expect(result.exitCode).not.toBe(0);
  });

  it("shows --help with examples", async () => {
    const result = await runCli(["webhooks", "enable", "--help"]);
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain("--yes");
  });
});
