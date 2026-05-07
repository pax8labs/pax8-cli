// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import {
  runCli,
  runCliExpectFailure,
  runCliExpectSuccess,
} from "./test-utils.js";

// IDs come from packages/core/src/mock/demo-data.ts. The orders webhook is
// seeded with two failed deliveries (502 and a timeout) which makes them
// the natural targets for retry tests.
const FAILED_LOG_ID = "22222222-3333-4444-5555-666666666604"; // 502 Bad Gateway
const TIMEOUT_LOG_ID = "22222222-3333-4444-5555-666666666605"; // timeout
const ORDERS_WEBHOOK_ID = "11111111-2222-3333-4444-555555555503";

describe("pax8 webhooks logs (subcommand group)", () => {
  it("preserves backward-compat: `logs` with no subcommand still lists", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "logs",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("webhookId");
    expect(data[0]).toHaveProperty("responseCode");
  });

  it("preserves backward-compat: `logs <webhook-id>` still lists for that webhook", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "logs",
      ORDERS_WEBHOOK_ID,
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    for (const log of data) {
      expect(log.webhookId).toBe(ORDERS_WEBHOOK_ID);
    }
  });

  it("explicit `logs list` returns the same shape", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "logs",
      "list",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("`logs --help` lists both `list` and `retry` subcommands", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "logs",
      "--help",
    ]);
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("retry");
  });
});

describe("pax8 webhooks logs retry", () => {
  it("retries a failed delivery via -y (resolves webhookId from log id)", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "logs",
      "retry",
      FAILED_LOG_ID,
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("logId", FAILED_LOG_ID);
    expect(data).toHaveProperty("webhookId", ORDERS_WEBHOOK_ID);
    expect(data).toHaveProperty("retried", true);
    expect(data).toHaveProperty("nextActions");
    expect(Array.isArray(data.nextActions)).toBe(true);
  });

  it("retries a timed-out delivery via -y", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "logs",
      "retry",
      TIMEOUT_LOG_ID,
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.logId).toBe(TIMEOUT_LOG_ID);
    expect(data.webhookId).toBe(ORDERS_WEBHOOK_ID);
    expect(data.retried).toBe(true);
  });

  it("honors an explicit --webhook id without listing first", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "logs",
      "retry",
      FAILED_LOG_ID,
      "--webhook",
      ORDERS_WEBHOOK_ID,
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.logId).toBe(FAILED_LOG_ID);
    expect(data.webhookId).toBe(ORDERS_WEBHOOK_ID);
  });

  it("emits a structured error when the log id is unknown", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "logs",
      "retry",
      "00000000-0000-0000-0000-000000000000",
      "--yes",
      "--json",
    ]);
    const start = result.stderr.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const json = JSON.parse(result.stderr.slice(start));
    expect(json).toHaveProperty("code", "ERROR_NOT_FOUND");
    expect(json).toHaveProperty("message");
  });

  it("requires confirmation when -y is omitted and stdin isn't a TTY", async () => {
    // No -y, no PAX8_YES, and a non-TTY stdin → the prompt receives EOF and
    // declines. The command must exit cleanly without retrying.
    const result = await runCli([
      "webhooks",
      "logs",
      "retry",
      FAILED_LOG_ID,
      "--json",
    ]);
    // Either the prompt rejects (success path with cancellation message) or
    // the readline closes the stream and exits 0/1; the key invariant is
    // that we did not produce a `retried: true` envelope without consent.
    expect(result.stdout).not.toContain('"retried": true');
  });

  it("shows examples in help text", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "logs",
      "retry",
      "--help",
    ]);
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain("--webhook");
  });
});
