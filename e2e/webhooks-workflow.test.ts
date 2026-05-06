import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("E2E: Webhooks workflow — list, create, test, logs, delete", () => {
  it("pax8 webhooks list returns a flat array of webhooks", async () => {
    const result = await runCliExpectSuccess(["webhooks", "list"]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    const first = data[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("url");
    expect(first).toHaveProperty("topics");
    expect(first).toHaveProperty("status");
  });

  it("pax8 webhooks list --with-actions wraps in { webhooks, nextActions }", async () => {
    const result = await runCliExpectSuccess(["webhooks", "list", "--with-actions"]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("webhooks");
    expect(data).toHaveProperty("nextActions");
    expect(Array.isArray(data.webhooks)).toBe(true);
    expect(Array.isArray(data.nextActions)).toBe(true);
  });

  it("pax8 webhooks list --ids-only emits one ID per line", async () => {
    const result = await runCliExpectSuccess(["webhooks", "list", "--ids-only"]);
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^\S+$/);
    }
  });

  it("pax8 webhooks create requires --url and --events", async () => {
    const result = await runCliExpectFailure(["webhooks", "create"]);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("pax8 webhooks create rejects an invalid URL", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "create",
      "--url",
      "not-a-url",
      "--events",
      "subscription.created",
      "--yes",
    ]);
    expect(result.stderr.toLowerCase()).toContain("invalid");
  });

  it("pax8 webhooks create persists a new subscription (with --yes)", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "create",
      "--url",
      "https://example.com/e2e-hook",
      "--events",
      "subscription.created,invoice.paid",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.url).toBe("https://example.com/e2e-hook");
    expect(data.topics).toEqual(["subscription.created", "invoice.paid"]);
    expect(data.status).toBe("Active");
    expect(data).toHaveProperty("nextActions");
  });

  it("pax8 webhooks test emits result JSON for an existing webhook", async () => {
    const list = await runCliExpectSuccess(["webhooks", "list"]);
    const id = JSON.parse(list.stdout)[0].id;

    const result = await runCliExpectSuccess(["webhooks", "test", id, "--json"]);
    const data = JSON.parse(result.stdout);
    expect(data.id).toBe(id);
    expect(data).toHaveProperty("result");
    expect(data).toHaveProperty("nextActions");
  });

  it("pax8 webhooks test fails for unknown webhook id", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "test",
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("pax8 webhooks logs (no id) returns aggregated logs as a flat array", async () => {
    const result = await runCliExpectSuccess(["webhooks", "logs", "--json"]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    const first = data[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("webhookId");
    expect(first).toHaveProperty("topic");
    expect(first).toHaveProperty("responseCode");
    expect(first).toHaveProperty("sentAt");
  });

  it("pax8 webhooks logs --with-actions wraps in { logs, nextActions }", async () => {
    const result = await runCliExpectSuccess(["webhooks", "logs", "--with-actions", "--json"]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("logs");
    expect(data).toHaveProperty("nextActions");
    expect(Array.isArray(data.logs)).toBe(true);
  });

  it("pax8 webhooks logs <id> filters to logs for that webhook", async () => {
    const list = await runCliExpectSuccess(["webhooks", "list"]);
    // Find a webhook that has logs in the demo data
    const webhooks = JSON.parse(list.stdout);
    let chosenId: string | null = null;
    for (const wh of webhooks) {
      const r = await runCliExpectSuccess(["webhooks", "logs", wh.id, "--json"]);
      if (JSON.parse(r.stdout).length > 0) {
        chosenId = wh.id;
        break;
      }
    }
    expect(chosenId).not.toBeNull();

    const result = await runCliExpectSuccess(["webhooks", "logs", chosenId!, "--json"]);
    const data = JSON.parse(result.stdout);
    expect(data.length).toBeGreaterThan(0);
    for (const log of data) {
      expect(log.webhookId).toBe(chosenId);
    }
  });

  it("pax8 webhooks logs --since rejects a malformed duration", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "logs",
      "--since",
      "garbage",
    ]);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("pax8 webhooks delete fails for unknown id", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "delete",
      "00000000-0000-0000-0000-000000000000",
      "--yes",
    ]);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("pax8 webhooks delete removes a webhook (with --yes)", async () => {
    const list = await runCliExpectSuccess(["webhooks", "list"]);
    const id = JSON.parse(list.stdout)[0].id;

    const result = await runCliExpectSuccess([
      "webhooks",
      "delete",
      id,
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.id).toBe(id);
    expect(data.deleted).toBe(true);
    expect(data).toHaveProperty("nextActions");
  });

  it("pax8 webhooks list --csv includes the expected columns", async () => {
    const result = await runCliExpectSuccess(["webhooks", "list", "--csv"]);
    const header = result.stdout.split("\n")[0].toLowerCase();
    expect(header).toContain("id");
    expect(header).toContain("url");
    expect(header).toContain("status");
  });
});
