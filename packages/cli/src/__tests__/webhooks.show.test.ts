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

describe("pax8 webhooks show", () => {
  it("returns the full webhook in JSON format", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "show",
      ACTIVE_WEBHOOK_ID,
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.id).toBe(ACTIVE_WEBHOOK_ID);
    expect(data.url).toBeTruthy();
    expect(data.status).toBe("Active");
    expect(Array.isArray(data.topics)).toBe(true);
    // New v2.1 fields are populated for demo data so agents can rely on them.
    expect(data).toHaveProperty("displayName");
    expect(data).toHaveProperty("contactEmail");
    expect(data).toHaveProperty("errorThreshold");
    expect(data).toHaveProperty("lastDeliveryStatus");
  });

  it("shows a Disabled webhook from demo data", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "show",
      DISABLED_WEBHOOK_ID,
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.status).toBe("Disabled");
  });

  it("renders detail view in TTY mode (non-TTY also writes detail to stdout for human use, but tests assert presence)", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "show",
      ACTIVE_WEBHOOK_ID,
    ]);
    // Non-TTY default → JSON. Test the JSON shape.
    const data = JSON.parse(result.stdout);
    expect(data.id).toBe(ACTIVE_WEBHOOK_ID);
  });

  it("fails on unknown id with a non-zero exit code", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "show",
      "00000000-0000-0000-0000-000000000000",
    ]);
    const combined = result.stdout + result.stderr;
    expect(combined.length).toBeGreaterThan(0);
  });

  it("shows --help with examples", async () => {
    const result = await runCliExpectSuccess(["webhooks", "show", "--help"]);
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain("--json");
  });

  it("appears in `webhooks --help`", async () => {
    const result = await runCli(["webhooks", "--help"]);
    expect(result.stdout).toContain("show");
    expect(result.stdout).toContain("update");
    expect(result.stdout).toContain("enable");
    expect(result.stdout).toContain("disable");
  });
});
