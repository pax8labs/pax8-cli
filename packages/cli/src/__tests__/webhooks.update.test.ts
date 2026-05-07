// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import {
  runCli,
  runCliExpectSuccess,
  runCliExpectFailure,
} from "./test-utils.js";

const ACTIVE_WEBHOOK_ID = "11111111-2222-3333-4444-555555555501";

describe("pax8 webhooks update", () => {
  it("requires at least one mutating flag", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "update",
      ACTIVE_WEBHOOK_ID,
      "--yes",
    ]);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/[Nn]o fields to update/);
  });

  it("updates display name with --yes and emits the updated webhook in JSON", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "update",
      ACTIVE_WEBHOOK_ID,
      "--display-name",
      "Subs prod",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.id).toBe(ACTIVE_WEBHOOK_ID);
    expect(data.displayName).toBe("Subs prod");
  });

  it("updates contactEmail and errorThreshold together", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "update",
      ACTIVE_WEBHOOK_ID,
      "--contact-email",
      "ops@new.example.com",
      "--error-threshold",
      "7",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.contactEmail).toBe("ops@new.example.com");
    expect(data.errorThreshold).toBe(7);
  });

  it("rejects an invalid email", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "update",
      ACTIVE_WEBHOOK_ID,
      "--contact-email",
      "not-an-email",
      "--yes",
    ]);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/[Ii]nvalid.*contact-email|email/);
  });

  it("rejects an out-of-range error threshold", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "update",
      ACTIVE_WEBHOOK_ID,
      "--error-threshold",
      "0",
      "--yes",
    ]);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/[Ii]nvalid.*error-threshold|between 1 and 20/);
  });

  it("rejects a non-integer error threshold", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "update",
      ACTIVE_WEBHOOK_ID,
      "--error-threshold",
      "abc",
      "--yes",
    ]);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/[Ii]nvalid.*error-threshold/);
  });

  it("rejects a too-large error threshold", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "update",
      ACTIVE_WEBHOOK_ID,
      "--error-threshold",
      "21",
      "--yes",
    ]);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/[Ii]nvalid.*error-threshold|between 1 and 20/);
  });

  it("redacts the authorization header in the confirm prompt (stderr) but leaves --json output intact", async () => {
    const auth = "Bearer abcdefghijklmnopqrstuvwxyz";
    const result = await runCliExpectSuccess([
      "webhooks",
      "update",
      ACTIVE_WEBHOOK_ID,
      "--authorization",
      auth,
      "--yes",
      "--json",
    ]);
    // The full secret must never appear on stderr (the diff preview).
    expect(result.stderr).not.toContain(auth);
    // The redaction should include the first and last 4 chars.
    expect(result.stderr).toContain("Bear");
    expect(result.stderr).toContain("wxyz");
    expect(result.stderr).toContain("...");
  });

  it("fails on unknown id", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "update",
      "00000000-0000-0000-0000-000000000000",
      "--display-name",
      "x",
      "--yes",
    ]);
    expect(result.exitCode).not.toBe(0);
  });

  it("shows --help with examples", async () => {
    const result = await runCli(["webhooks", "update", "--help"]);
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain("--display-name");
    expect(result.stdout).toContain("--authorization");
    expect(result.stdout).toContain("--contact-email");
    expect(result.stdout).toContain("--error-threshold");
  });
});
