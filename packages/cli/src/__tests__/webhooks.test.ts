// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import {
  runCliExpectFailure,
  runCliExpectSuccess,
} from "./test-utils.js";

const SUBS_WEBHOOK_ID = "11111111-2222-3333-4444-555555555501";
const ORDERS_WEBHOOK_ID = "11111111-2222-3333-4444-555555555503";

describe("pax8 webhooks test", () => {
  it("sends a generic webhook-level test (no --topic)", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "test",
      SUBS_WEBHOOK_ID,
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("id", SUBS_WEBHOOK_ID);
    expect(data).toHaveProperty("result");
    // No --topic set → topic field is null/undefined in the envelope
    expect(data.topic ?? null).toBeNull();
    expect(data).toHaveProperty("nextActions");
  });

  it("routes to the topic-specific endpoint with --topic", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "test",
      SUBS_WEBHOOK_ID,
      "--topic",
      "subscription.created",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.id).toBe(SUBS_WEBHOOK_ID);
    expect(data.topic).toBe("subscription.created");
    expect(data.result).toBeDefined();
    // Mock testTopic returns the topic in its response payload
    const result2 = data.result as Record<string, unknown>;
    expect(result2.topic).toBe("subscription.created");
  });

  it("rejects an unknown --topic with ERROR_INVALID_INPUT", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "test",
      SUBS_WEBHOOK_ID,
      "--topic",
      "definitely.not.a.topic",
      "--json",
    ]);
    const start = result.stderr.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const json = JSON.parse(result.stderr.slice(start));
    expect(json).toHaveProperty("code", "ERROR_INVALID_INPUT");
    // Error must point the user at the discovery command
    const text = JSON.stringify(json);
    expect(text).toContain("topics list");
  });

  it("includes --topic in help text examples", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "test",
      "--help",
    ]);
    expect(result.stdout).toContain("--topic");
    expect(result.stdout).toContain("Examples:");
  });

  it("works for a disabled webhook (returns the failure code in result)", async () => {
    // The orders webhook is seeded as Disabled; the mock returns 502.
    const result = await runCliExpectSuccess([
      "webhooks",
      "test",
      ORDERS_WEBHOOK_ID,
      "--topic",
      "order.created",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.id).toBe(ORDERS_WEBHOOK_ID);
    expect(data.topic).toBe("order.created");
    const inner = data.result as Record<string, unknown>;
    expect(inner.responseCode).toBe(502);
  });
});

describe("pax8 webhooks create — --topics canonical with --events deprecated alias (#273)", () => {
  it("accepts --topics and persists the webhook", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "create",
      "--url",
      "https://example.com/topics-hook",
      "--topics",
      "subscription.created,invoice.paid",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.url).toBe("https://example.com/topics-hook");
    expect(data.topics).toEqual(["subscription.created", "invoice.paid"]);
    // Canonical flag must not emit the deprecation banner.
    expect(result.stderr).not.toContain("--events is deprecated");
  });

  it("still accepts --events as a deprecated alias and warns on stderr", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "create",
      "--url",
      "https://example.com/events-hook",
      "--events",
      "subscription.created",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.url).toBe("https://example.com/events-hook");
    expect(data.topics).toEqual(["subscription.created"]);
    expect(result.stderr).toContain(
      "--events is deprecated; use --topics. Will be removed in v1.0.",
    );
  });

  it("errors clearly when both --topics and --events are passed", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "create",
      "--url",
      "https://example.com/dup-hook",
      "--topics",
      "subscription.created",
      "--events",
      "invoice.paid",
      "--yes",
    ]);
    expect(result.stderr).toContain("Specify only one of --topics or --events");
  });

  it("--help mentions --topics as canonical and --events as deprecated", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "create",
      "--help",
    ]);
    expect(result.stdout).toContain("--topics");
    expect(result.stdout).toContain("--events");
    expect(result.stdout.toLowerCase()).toContain("deprecated");
  });
});
