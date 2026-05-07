// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhooksApi } from "./webhooks.js";
import type { Pax8Client } from "./client.js";

function createMockClient(): Pax8Client {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getPaginated: vi.fn(),
  } as unknown as Pax8Client;
}

const WEBHOOK_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const sampleWebhook = {
  id: WEBHOOK_ID,
  url: "https://example.com/webhook",
  topics: ["subscription.created"],
  status: "Active",
  createdDate: "2026-01-15",
  secret: "whsec_test",
};

const sampleLog = {
  id: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  webhookId: WEBHOOK_ID,
  topic: "subscription.created",
  responseCode: 200,
  responseBody: "OK",
  sentAt: "2026-03-15T10:00:00Z",
};

describe("WebhooksApi", () => {
  let client: Pax8Client;
  let api: WebhooksApi;

  beforeEach(() => {
    client = createMockClient();
    api = new WebhooksApi(client);
  });

  it("list returns webhooks array", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue([sampleWebhook]);

    const result = await api.list();

    expect(client.get).toHaveBeenCalledWith("/webhooks");
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com/webhook");
  });

  it("get returns a single webhook", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleWebhook);

    const result = await api.get(WEBHOOK_ID);

    expect(client.get).toHaveBeenCalledWith(`/webhooks/${WEBHOOK_ID}`);
    expect(result.topics).toContain("subscription.created");
  });

  it("create sends correct body", async () => {
    const input = { url: "https://example.com/new", topics: ["order.created"] };
    const created = { ...sampleWebhook, ...input, id: "c3d4e5f6-a7b8-9012-cdef-123456789012" };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(created);

    const result = await api.create(input);

    expect(client.post).toHaveBeenCalledWith("/webhooks", input);
    expect(result.url).toBe("https://example.com/new");
  });

  it("update sends correct body", async () => {
    const input = { url: "https://example.com/updated" };
    const updated = { ...sampleWebhook, url: "https://example.com/updated" };
    (client.put as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.update(WEBHOOK_ID, input);

    expect(client.put).toHaveBeenCalledWith(`/webhooks/${WEBHOOK_ID}`, input);
    expect(result.url).toBe("https://example.com/updated");
  });

  it("updateStatus sends patch with status", async () => {
    const updated = { ...sampleWebhook, status: "Disabled" };
    (client.patch as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.updateStatus(WEBHOOK_ID, "Disabled");

    expect(client.patch).toHaveBeenCalledWith(`/webhooks/${WEBHOOK_ID}`, { status: "Disabled" });
    expect(result.status).toBe("Disabled");
  });

  it("updateConfiguration POSTs to /configuration with the partial body", async () => {
    const input = {
      displayName: "Subs prod",
      contactEmail: "ops@example.com",
      errorThreshold: 5,
    };
    const updated = { ...sampleWebhook, ...input };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.updateConfiguration(WEBHOOK_ID, input);

    expect(client.post).toHaveBeenCalledWith(
      `/webhooks/${WEBHOOK_ID}/configuration`,
      input,
    );
    expect(result.displayName).toBe("Subs prod");
    expect(result.errorThreshold).toBe(5);
  });

  it("setStatus(true) POSTs to /status with { active: true }", async () => {
    const updated = { ...sampleWebhook, status: "Active" };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.setStatus(WEBHOOK_ID, true);

    expect(client.post).toHaveBeenCalledWith(
      `/webhooks/${WEBHOOK_ID}/status`,
      { active: true },
    );
    expect(result.status).toBe("Active");
  });

  it("setStatus(false) POSTs to /status with { active: false }", async () => {
    const updated = { ...sampleWebhook, status: "Disabled" };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.setStatus(WEBHOOK_ID, false);

    expect(client.post).toHaveBeenCalledWith(
      `/webhooks/${WEBHOOK_ID}/status`,
      { active: false },
    );
    expect(result.status).toBe("Disabled");
  });

  it("delete calls client.delete", async () => {
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await api.delete(WEBHOOK_ID);

    expect(client.delete).toHaveBeenCalledWith(`/webhooks/${WEBHOOK_ID}`);
  });

  it("test sends POST to test endpoint", async () => {
    const testResult = { success: true };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(testResult);

    const result = await api.test(WEBHOOK_ID);

    expect(client.post).toHaveBeenCalledWith(`/webhooks/${WEBHOOK_ID}/test`, {});
    expect(result).toEqual(testResult);
  });

  it("getLogs returns webhook logs", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue([sampleLog]);

    const result = await api.getLogs(WEBHOOK_ID);

    expect(client.get).toHaveBeenCalledWith(`/webhooks/${WEBHOOK_ID}/logs`);
    expect(result).toHaveLength(1);
    expect(result[0].responseCode).toBe(200);
  });

  it("retryLog sends POST to retry endpoint", async () => {
    const retryResult = { success: true };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(retryResult);

    const result = await api.retryLog(WEBHOOK_ID, sampleLog.id);

    expect(client.post).toHaveBeenCalledWith(
      `/webhooks/${WEBHOOK_ID}/logs/${sampleLog.id}/retry`,
      {},
    );
    expect(result).toEqual(retryResult);
  });
});
