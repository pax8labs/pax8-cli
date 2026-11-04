// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Pax8Client } from "./client.js";
import { ApiError } from "./errors.js";

const mockTokenManager = { getToken: vi.fn().mockResolvedValue("test-token") };

function createClient(options?: Partial<{ baseUrl: string; timeout: number; debug: boolean }>) {
  return new Pax8Client({
    tokenManager: mockTokenManager,
    baseUrl: "https://api.pax8.com/v1",
    cacheTtlMs: 0,
    ...options,
  });
}

describe("Pax8Client — extended coverage", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockTokenManager.getToken.mockResolvedValue("test-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("PUT sends correct method", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: () => Promise.resolve({ updated: true }),
    });
    const client = createClient();

    const result = await client.put("/companies/123", { name: "Updated" });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ name: "Updated" }));
    expect(result).toEqual({ updated: true });
  });

  it("PATCH sends correct method", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: () => Promise.resolve({ patched: true }),
    });
    const client = createClient();

    const result = await client.patch("/webhooks/123", { status: "Disabled" });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(result).toEqual({ patched: true });
  });

  it("strips trailing slashes from baseUrl", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: () => Promise.resolve({}),
    });
    const client = createClient({ baseUrl: "https://api.pax8.com/v1///" });

    await client.get("/test");

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url.toString()).toContain("https://api.pax8.com/v1/test");
    expect(url.toString()).not.toContain("///");
  });

  it("handles path without leading slash", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: () => Promise.resolve({}),
    });
    const client = createClient();

    await client.get("companies");

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url.toString()).toContain("/companies");
  });

  it("retries on network error with backoff", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        json: () => Promise.resolve({ recovered: true }),
      });

    globalThis.fetch = fetchMock;
    const client = createClient();

    const result = await client.get("/test");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ recovered: true });
  });

  it("throws ApiError after all network retries exhausted", { timeout: 30000 }, async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    globalThis.fetch = fetchMock;
    const client = createClient();

    await expect(client.get("/test")).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it("429 without Retry-After header uses attempt-based delay", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers(), // No Retry-After
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
      });

    globalThis.fetch = fetchMock;
    const client = createClient();

    const result = await client.get("/test");
    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("getPaginated with schema validation", async () => {
    const { z } = await import("zod");
    const ItemSchema = z.object({ id: z.string(), name: z.string() });

    const page1 = {
      page: { size: 1, totalElements: 2, totalPages: 2, number: 0 },
      content: [{ id: "1", name: "Item 1" }],
    };
    const page2 = {
      page: { size: 1, totalElements: 2, totalPages: 2, number: 1 },
      content: [{ id: "2", name: "Item 2" }],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        json: () => Promise.resolve(page1),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        json: () => Promise.resolve(page2),
      });

    globalThis.fetch = fetchMock;
    const client = createClient();

    const allItems: unknown[] = [];
    for await (const items of client.getPaginated("/items", undefined, ItemSchema)) {
      allItems.push(...items);
    }

    expect(allItems).toHaveLength(2);
  });

  it("DELETE with non-204 status still returns void", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: () => Promise.resolve({}),
    });
    const client = createClient();

    const result = await client.delete("/items/123");
    expect(result).toBeUndefined();
  });

  it("safeJson handles json parse failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: new Headers(),
      json: () => Promise.reject(new Error("invalid json")),
    });
    const client = createClient();

    await expect(client.get("/bad")).rejects.toThrow(ApiError);
  });

  // ───────────────────────────────────────────────────────────────────────
  // #233 — 401 recovery: clear stale token cache and retry once.
  // ───────────────────────────────────────────────────────────────────────

  describe("401 cache-clear retry (#233)", () => {
    function jsonResponse(
      status: number,
      body: unknown,
      headers: Record<string, string> = {},
    ) {
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? "OK" : "Unauthorized",
        headers: new Headers(headers),
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      };
    }

    it("clears the token cache and retries once on a 401, then succeeds", async () => {
      const getToken = vi
        .fn()
        .mockResolvedValueOnce("stale-token")
        .mockResolvedValueOnce("fresh-token");
      const clearCache = vi.fn();
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(401, { error: "token revoked" }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
      globalThis.fetch = fetchFn as unknown as typeof fetch;

      const client = new Pax8Client({
        tokenManager: { getToken, clearCache },
        baseUrl: "https://api.pax8.com/v1",
        cacheTtlMs: 0,
      });

      const result = await client.get<{ ok: boolean }>("/companies");
      expect(result).toEqual({ ok: true });
      expect(clearCache).toHaveBeenCalledOnce();
      expect(getToken).toHaveBeenCalledTimes(2);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      // The retry must carry the fresh Authorization header.
      const secondCallInit = fetchFn.mock.calls[1][1] as RequestInit;
      const secondHeaders = secondCallInit.headers as Record<string, string>;
      expect(secondHeaders.Authorization).toBe("Bearer fresh-token");
    });

    it("does not retry a second time when the retry also returns 401", async () => {
      const getToken = vi.fn().mockResolvedValue("any-token");
      const clearCache = vi.fn();
      const fetchFn = vi
        .fn()
        .mockResolvedValue(jsonResponse(401, { error: "still unauthorized" }));
      globalThis.fetch = fetchFn as unknown as typeof fetch;

      const client = new Pax8Client({
        tokenManager: { getToken, clearCache },
        baseUrl: "https://api.pax8.com/v1",
        cacheTtlMs: 0,
      });

      await expect(client.get("/companies")).rejects.toThrow(ApiError);
      // One cache clear + exactly two fetches (initial + single retry).
      expect(clearCache).toHaveBeenCalledOnce();
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("does not invoke clearCache when the token manager lacks the hook", async () => {
      // Older / embedder-provided token managers may not implement
      // clearCache. The optional-chaining call must not throw and the
      // retry must still happen.
      const getToken = vi
        .fn()
        .mockResolvedValueOnce("first")
        .mockResolvedValueOnce("second");
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(401, { error: "revoked" }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
      globalThis.fetch = fetchFn as unknown as typeof fetch;

      const client = new Pax8Client({
        tokenManager: { getToken },
        baseUrl: "https://api.pax8.com/v1",
        cacheTtlMs: 0,
      });

      await expect(client.get("/x")).resolves.toEqual({ ok: true });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("does not enter the retry loop on a 403 (only 401 triggers cache clear)", async () => {
      // Pin the boundary: 403 (forbidden, not unauthorized) must NOT
      // clear the token cache — the token is valid, the user just
      // doesn't have access to this resource.
      const getToken = vi.fn().mockResolvedValue("token");
      const clearCache = vi.fn();
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));
      globalThis.fetch = fetchFn as unknown as typeof fetch;

      const client = new Pax8Client({
        tokenManager: { getToken, clearCache },
        baseUrl: "https://api.pax8.com/v1",
        cacheTtlMs: 0,
      });

      await expect(client.get("/x")).rejects.toThrow(ApiError);
      expect(clearCache).not.toHaveBeenCalled();
      expect(fetchFn).toHaveBeenCalledOnce();
    });

    // Regression: PR #649 round-2 bot review caught that a 401 landing on
    // the final retry slot (after earlier slots are burned by 429s) would
    // set retriedAfterAuthClear=true, continue the loop, and fall through
    // to `throw lastError ?? new Error("Unexpected error")` — a code-less
    // bare Error that violates the "errors carry codes" contract. The
    // fix (client.ts) gates the 401 retry on `attempt < MAX_RETRIES` so a
    // terminal 401 falls through to the !response.ok branch and surfaces
    // as a structured ApiError(401).
    it("surfaces ApiError(401), not a bare Error, when a 401 lands on the final retry slot", async () => {
      const getToken = vi.fn().mockResolvedValue("token");
      const clearCache = vi.fn();
      // MAX_RETRIES=3 → up to 4 attempts (indices 0..3). Burn the first
      // three on 429s, then return 401 on the final slot. Retry-After=0
      // skips the 429 backoff sleep so the test runs instantly.
      const r429 = jsonResponse(429, { error: "rate limited" }, { "Retry-After": "0" });
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(r429)
        .mockResolvedValueOnce(r429)
        .mockResolvedValueOnce(r429)
        .mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }));
      globalThis.fetch = fetchFn as unknown as typeof fetch;

      const client = new Pax8Client({
        tokenManager: { getToken, clearCache },
        baseUrl: "https://api.pax8.com/v1",
        cacheTtlMs: 0,
      });

      // The throw MUST be an ApiError (carries status + ERROR_* code),
      // never a bare Error("Unexpected error"). That's the regression.
      await expect(client.get("/x")).rejects.toThrow(ApiError);
      // Cache must NOT be cleared because the terminal-slot guard
      // short-circuits before the clear-and-retry side effect.
      expect(clearCache).not.toHaveBeenCalled();
      // Three 429s + one 401 = 4 fetch calls. No retry beyond the 401.
      expect(fetchFn).toHaveBeenCalledTimes(4);
    });
  });
});
