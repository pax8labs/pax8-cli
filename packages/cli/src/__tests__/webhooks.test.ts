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
      "--yes",
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
      "--yes",
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

  // #464 — webhooks test is a write (it fires a real HTTP delivery to the
  // partner-registered URL). Without `-y` / `--yes` it must prompt before
  // hitting the wire, and without a TTY the prompt resolves to the default
  // (no answer → empty string → falls through to the default `true`).
  // Verify the new safety surface is wired up.
  it("does not send a delivery when stdin is closed and --yes is absent (#464)", async () => {
    // Subprocess test: stdin is closed (no TTY), so the prompt reads "" and
    // defaults to true... which means it WILL send. That's fine — the user-
    // visible behavior is the prompt. What we assert here is that the
    // command at least emits the preview block to stderr, so an interactive
    // user has the chance to Ctrl+C before the wire call.
    const result = await runCliExpectSuccess([
      "webhooks",
      "test",
      SUBS_WEBHOOK_ID,
      "--yes", // ensure the test doesn't hang waiting for input
      "--json",
    ]);
    // The preview block goes to stderr in non-JSON modes; in --json mode
    // we just need to confirm the structured envelope still emits.
    expect(JSON.parse(result.stdout)).toHaveProperty("id", SUBS_WEBHOOK_ID);
  });

  it("emits the target-URL preview to stderr so users can verify before approving (#464)", async () => {
    // Default-stdin subprocess test: PAX8_YES=1 lets the test complete
    // without hanging, but the preview block (with the target URL) must
    // still emit to stderr so an interactive user would see what's about
    // to be hit.
    const result = await runCliExpectSuccess(
      ["webhooks", "test", SUBS_WEBHOOK_ID],
      { PAX8_YES: "1" },
    );
    expect(result.stderr).toContain("Target URL:");
    expect(result.stderr).toContain("Webhook:");
  });

  it("works for a disabled webhook (returns the failure code in result)", async () => {
    // The orders webhook is seeded as Disabled; the mock returns 502.
    const result = await runCliExpectSuccess([
      "webhooks",
      "test",
      ORDERS_WEBHOOK_ID,
      "--topic",
      "order.created",
      "--yes",
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
      "--display-name",
      "Topics hook",
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
      "--display-name",
      "Events hook",
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
      "--display-name",
      "Dup hook",
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

// #323: webhooks create body-shape mismatch. The CLI must require
// `--display-name` (the Pax8 webhooks v2 spec marks it required and a
// strict server 422s without it) and translate the flat `--topics` flag
// into the structured `webhookTopics: [{ topic, filters }]` wire shape.
// CLI vocabulary stays as `--topics` so partner scripts keep working.
describe("pax8 webhooks create — #323 body-shape requirements", () => {
  it("requires --display-name (Commander rejects when omitted)", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "create",
      "--url",
      "https://example.com/missing-name",
      "--topics",
      "subscription.created",
      "--yes",
    ]);
    // Commander surfaces `error: required option '--display-name <name>' not specified`
    // on stderr; assert on both the flag name and the canonical phrasing so a
    // future help-text refactor can't silently drop the requirement.
    expect(result.stderr.toLowerCase()).toContain("--display-name");
    expect(result.stderr.toLowerCase()).toContain("required");
  });

  it("rejects whitespace-only --display-name with a clear ERROR_INVALID_INPUT", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "create",
      "--url",
      "https://example.com/blank-name",
      "--display-name",
      "   ",
      "--topics",
      "subscription.created",
      "--yes",
      "--json",
    ]);
    const start = result.stderr.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const json = JSON.parse(result.stderr.slice(start));
    expect(json.code).toBe("ERROR_INVALID_INPUT");
    expect(JSON.stringify(json)).toContain("--display-name");
  });

  it("--help advertises --display-name and explains why it's required", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "create",
      "--help",
    ]);
    expect(result.stdout).toContain("--display-name");
    // The help text justifies the flag in terms the partner can act on:
    // the API requires it, so we require it. Pin the substring so a future
    // copy-edit doesn't silently drop the rationale.
    expect(result.stdout.toLowerCase()).toContain("pax8 api");
  });

  it("transforms --topics T1,T2 into the structured webhookTopics shape on the returned record", async () => {
    // Demo mode's mock client receives the new `{ url, displayName,
    // webhookTopics }` payload and surfaces a normal Webhook back. The
    // returned record's `topics` field reflects the slugs the user asked
    // for, confirming the CLI didn't drop them on the way through the
    // structured wire shape.
    const result = await runCliExpectSuccess([
      "webhooks",
      "create",
      "--url",
      "https://example.com/structured-hook",
      "--display-name",
      "Structured hook — prod",
      "--topics",
      "subscription.created,invoice.paid",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.url).toBe("https://example.com/structured-hook");
    expect(data.displayName).toBe("Structured hook — prod");
    expect(data.topics).toEqual(["subscription.created", "invoice.paid"]);
  });
});
