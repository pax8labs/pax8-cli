// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebhooksApi } from "./webhooks.js";
import { Pax8Client } from "./client.js";

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
  createdAt: "2026-01-15",
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

// Per #322: every WebhooksApi call must thread `{ api: "webhooks" }` through
// to the client so the resolved wire URL lands at
// `https://api.pax8.com/api/v2/webhooks/...` instead of the project-wide `/v1`
// default. Regression here means a webhook operation is back on /v1 and will
// 404 against the real Pax8 API.
const WEBHOOKS_OPTS = { api: "webhooks" };

describe("WebhooksApi", () => {
  let client: Pax8Client;
  let api: WebhooksApi;

  beforeEach(() => {
    client = createMockClient();
    api = new WebhooksApi(client);
  });

  it("list returns webhooks array (routed to /api/v2)", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue([sampleWebhook]);

    const result = await api.list();

    expect(client.get).toHaveBeenCalledWith("/webhooks", undefined, WEBHOOKS_OPTS);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com/webhook");
  });

  it("get returns a single webhook (routed to /api/v2)", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(sampleWebhook);

    const result = await api.get(WEBHOOK_ID);

    expect(client.get).toHaveBeenCalledWith(
      `/webhooks/${WEBHOOK_ID}`,
      undefined,
      WEBHOOKS_OPTS,
    );
    expect(result.topics).toContain("subscription.created");
  });

  it("create sends the spec-shaped body { url, displayName, webhookTopics } (routed to /api/v2, #323)", async () => {
    // The Pax8 webhooks v2 spec requires `displayName` and uses the
    // structured `webhookTopics: Array<{ topic, filters }>` shape — not the
    // pre-#323 `topics: string[]`. WebhooksApi.create must serialize the
    // input it receives verbatim onto the wire so a spec-strict server
    // accepts it.
    const input = {
      url: "https://example.com/new",
      displayName: "Order events — prod",
      webhookTopics: [
        { topic: "order.created", filters: [] },
        { topic: "order.completed", filters: [] },
      ],
    };
    const created = {
      ...sampleWebhook,
      id: "c3d4e5f6-a7b8-9012-cdef-123456789012",
      url: input.url,
      topics: ["order.created", "order.completed"],
      displayName: input.displayName,
    };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(created);

    const result = await api.create(input);

    expect(client.post).toHaveBeenCalledWith("/webhooks", input, WEBHOOKS_OPTS);
    expect(result.url).toBe("https://example.com/new");
    expect(result.displayName).toBe("Order events — prod");
  });

  it("updateConfiguration POSTs to /configuration with the partial body (routed to /api/v2)", async () => {
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
      WEBHOOKS_OPTS,
    );
    expect(result.displayName).toBe("Subs prod");
    expect(result.errorThreshold).toBe(5);
  });

  it("setStatus(true) POSTs to /status with { active: true } (routed to /api/v2)", async () => {
    const updated = { ...sampleWebhook, status: "Active" };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.setStatus(WEBHOOK_ID, true);

    expect(client.post).toHaveBeenCalledWith(
      `/webhooks/${WEBHOOK_ID}/status`,
      { active: true },
      WEBHOOKS_OPTS,
    );
    expect(result.status).toBe("Active");
  });

  it("setStatus(false) POSTs to /status with { active: false } (routed to /api/v2)", async () => {
    const updated = { ...sampleWebhook, status: "Disabled" };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await api.setStatus(WEBHOOK_ID, false);

    expect(client.post).toHaveBeenCalledWith(
      `/webhooks/${WEBHOOK_ID}/status`,
      { active: false },
      WEBHOOKS_OPTS,
    );
    expect(result.status).toBe("Disabled");
  });

  it("delete calls client.delete (routed to /api/v2)", async () => {
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await api.delete(WEBHOOK_ID);

    expect(client.delete).toHaveBeenCalledWith(
      `/webhooks/${WEBHOOK_ID}`,
      undefined,
      WEBHOOKS_OPTS,
    );
  });

  it("test sends POST to test endpoint (routed to /api/v2)", async () => {
    const testResult = { success: true };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(testResult);

    const result = await api.test(WEBHOOK_ID);

    expect(client.post).toHaveBeenCalledWith(
      `/webhooks/${WEBHOOK_ID}/test`,
      {},
      WEBHOOKS_OPTS,
    );
    expect(result).toEqual(testResult);
  });

  it("testTopic URL-encodes the topic segment and POSTs (routed to /api/v2)", async () => {
    const testResult = { success: true };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(testResult);

    await api.testTopic(WEBHOOK_ID, "subscription.created");

    expect(client.post).toHaveBeenCalledWith(
      `/webhooks/${WEBHOOK_ID}/topics/subscription.created/test`,
      {},
      WEBHOOKS_OPTS,
    );
  });

  it("getLogs returns webhook logs (routed to /api/v2)", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue([sampleLog]);

    const result = await api.getLogs(WEBHOOK_ID);

    expect(client.get).toHaveBeenCalledWith(
      `/webhooks/${WEBHOOK_ID}/logs`,
      undefined,
      WEBHOOKS_OPTS,
    );
    expect(result).toHaveLength(1);
    expect(result[0].responseCode).toBe(200);
  });

  it("retryLog sends POST to retry endpoint (routed to /api/v2)", async () => {
    const retryResult = { success: true };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(retryResult);

    const result = await api.retryLog(WEBHOOK_ID, sampleLog.id);

    expect(client.post).toHaveBeenCalledWith(
      `/webhooks/${WEBHOOK_ID}/logs/${sampleLog.id}/retry`,
      {},
      WEBHOOKS_OPTS,
    );
    expect(result).toEqual(retryResult);
  });

  it("getTopicDefinitions unwraps paginated envelope and threads the override", async () => {
    const topics = [
      {
        topic: "subscription.created",
        name: "Subscription Created",
        description: "Fires on new subs",
      },
    ];
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: topics,
      page: { size: 200, totalElements: 1, totalPages: 1, number: 0 },
    });

    const result = await api.getTopicDefinitions();

    expect(client.get).toHaveBeenCalledWith(
      "/webhooks/topic-definitions",
      { size: 200 },
      WEBHOOKS_OPTS,
    );
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe("subscription.created");
  });
});

// Wire-level regression guard for #322: with a real `Pax8Client` (no stubs)
// configured with the `webhooks → https://api.pax8.com/api/v2` override that
// `packages/cli/src/lib/context.ts` registers in production, every
// `WebhooksApi` call must resolve to `https://api.pax8.com/api/v2/webhooks/...`
// — not the project-wide `/v1` default. Pattern matches
// `client.test.ts` describe block "Pax8Client per-API base overrides (#321)".
describe("WebhooksApi wire-level routing (#322)", () => {
  let originalFetch: typeof globalThis.fetch;
  const tokenManager = { getToken: vi.fn().mockResolvedValue("test-token") };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    tokenManager.getToken.mockResolvedValue("test-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockJson(status: number, body: unknown) {
    return vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : status === 204 ? "No Content" : "Error",
      headers: new Headers(),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  }

  function createWebhooksClient() {
    return new Pax8Client({
      tokenManager,
      baseUrl: "https://api.pax8.com/v1",
      apiBaseOverrides: {
        webhooks: "https://api.pax8.com/api/v2",
      },
      cacheTtlMs: 0,
    });
  }

  it("list resolves to https://api.pax8.com/api/v2/webhooks", async () => {
    globalThis.fetch = mockJson(200, []);
    const api = new WebhooksApi(createWebhooksClient());

    await api.list();

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url.toString()).toBe("https://api.pax8.com/api/v2/webhooks");
  });

  it("create resolves to https://api.pax8.com/api/v2/webhooks", async () => {
    globalThis.fetch = mockJson(200, sampleWebhook);
    const api = new WebhooksApi(createWebhooksClient());

    await api.create({
      url: "https://example.com/new",
      displayName: "Order events",
      webhookTopics: [{ topic: "order.created", filters: [] }],
    });

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url.toString()).toBe("https://api.pax8.com/api/v2/webhooks");
    expect(init.method).toBe("POST");
    // Pin the wire body shape: confirms #323 reshape is preserved through
    // serialization, not just at the typed input boundary.
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      url: "https://example.com/new",
      displayName: "Order events",
      webhookTopics: [{ topic: "order.created", filters: [] }],
    });
  });

  it("setStatus resolves to https://api.pax8.com/api/v2/webhooks/{id}/status", async () => {
    globalThis.fetch = mockJson(200, sampleWebhook);
    const api = new WebhooksApi(createWebhooksClient());

    await api.setStatus(WEBHOOK_ID, true);

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url.toString()).toBe(
      `https://api.pax8.com/api/v2/webhooks/${WEBHOOK_ID}/status`,
    );
  });

  it("updateConfiguration resolves to https://api.pax8.com/api/v2/webhooks/{id}/configuration", async () => {
    globalThis.fetch = mockJson(200, sampleWebhook);
    const api = new WebhooksApi(createWebhooksClient());

    await api.updateConfiguration(WEBHOOK_ID, { displayName: "Subs prod" });

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url.toString()).toBe(
      `https://api.pax8.com/api/v2/webhooks/${WEBHOOK_ID}/configuration`,
    );
  });

  it("delete resolves to https://api.pax8.com/api/v2/webhooks/{id}", async () => {
    globalThis.fetch = mockJson(204, undefined);
    const api = new WebhooksApi(createWebhooksClient());

    await api.delete(WEBHOOK_ID);

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url.toString()).toBe(
      `https://api.pax8.com/api/v2/webhooks/${WEBHOOK_ID}`,
    );
    expect(init.method).toBe("DELETE");
  });

  it("retryLog resolves to https://api.pax8.com/api/v2/webhooks/{id}/logs/{logId}/retry", async () => {
    globalThis.fetch = mockJson(200, { success: true });
    const api = new WebhooksApi(createWebhooksClient());

    await api.retryLog(WEBHOOK_ID, sampleLog.id);

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url.toString()).toBe(
      `https://api.pax8.com/api/v2/webhooks/${WEBHOOK_ID}/logs/${sampleLog.id}/retry`,
    );
  });

  it("falls back to /v1 silently when the webhooks override is not registered", async () => {
    // Defensive guard: if a downstream embedder forgets to register the
    // webhooks override, the call falls back to the project-wide default
    // rather than crashing. The call will 404 against the real API — but
    // it won't take the process down at construction time. Matches the
    // resolveBaseUrl unknown-key behavior (#321).
    globalThis.fetch = mockJson(200, []);
    const client = new Pax8Client({
      tokenManager,
      baseUrl: "https://api.pax8.com/v1",
      cacheTtlMs: 0,
    });
    const api = new WebhooksApi(client);

    await api.list();

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url.toString()).toBe("https://api.pax8.com/v1/webhooks");
  });
});
