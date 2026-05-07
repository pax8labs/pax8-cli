// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Pax8Client, getDefaultBaseUrl } from "./client.js";
import { ApiError, RateLimitError } from "./errors.js";
import {
  Pax8SecurityError,
  validateBaseUrl,
} from "../security/validate-env.js";
import { redactDebugBody } from "../security/redact-debug.js";
import { ERROR_INVALID_INPUT } from "../errors/codes.js";

const mockTokenManager = { getToken: vi.fn().mockResolvedValue("test-token") };

function createClient(options?: Partial<{ baseUrl: string; timeout: number; debug: boolean }>) {
  return new Pax8Client({
    tokenManager: mockTokenManager,
    baseUrl: "https://api.pax8.com/v1",
    cacheTtlMs: 0,
    ...options,
  });
}

function mockFetchResponse(status: number, body?: unknown, headers?: Record<string, string>) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 429 ? "Too Many Requests" : "Error",
    headers: new Headers(headers ?? {}),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe("Pax8Client", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockTokenManager.getToken.mockResolvedValue("test-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET with query params", async () => {
    const responseData = { id: "123", name: "Test" };
    globalThis.fetch = mockFetchResponse(200, responseData);
    const client = createClient();

    const result = await client.get("/companies", { page: 0, size: 10, filter: undefined });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url.toString()).toContain("/companies");
    expect(url.toString()).toContain("page=0");
    expect(url.toString()).toContain("size=10");
    expect(url.toString()).not.toContain("filter");
    expect(init.method).toBe("GET");
    expect(result).toEqual(responseData);
  });

  it("POST with body", async () => {
    const requestBody = { name: "New Company" };
    const responseData = { id: "456", name: "New Company" };
    globalThis.fetch = mockFetchResponse(200, responseData);
    const client = createClient();

    const result = await client.post("/companies", requestBody);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(requestBody));
    expect(result).toEqual(responseData);
  });

  it("injects Authorization header", async () => {
    globalThis.fetch = mockFetchResponse(200, {});
    const client = createClient();

    await client.get("/test");

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer test-token");
  });

  it("retries on 429 with Retry-After header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers({ "Retry-After": "0" }),
        json: () => Promise.resolve({ message: "rate limited" }),
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ success: true });
  });

  it("throws RateLimitError after exhausting retries on 429", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: new Headers({ "Retry-After": "0" }),
      json: () => Promise.resolve({ message: "rate limited" }),
    });

    globalThis.fetch = fetchMock;
    const client = createClient();

    await expect(client.get("/test")).rejects.toThrow(RateLimitError);
    // initial + 3 retries = 4 calls
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("retries on 5xx with exponential backoff", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Headers(),
        json: () => Promise.resolve({ error: "server error" }),
      })
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

  it("throws ApiError after exhausting retries on 5xx", { timeout: 15000 }, async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      headers: new Headers(),
      json: () => Promise.resolve({ error: "down" }),
    });

    globalThis.fetch = fetchMock;
    const client = createClient();

    await expect(client.get("/test")).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("throws ApiError on non-2xx non-retryable response", async () => {
    globalThis.fetch = mockFetchResponse(404, { message: "Not found" });
    const client = createClient();

    await expect(client.get("/companies/nonexistent")).rejects.toThrow(ApiError);
    try {
      await client.get("/companies/nonexistent");
    } catch (e) {
      expect((e as ApiError).statusCode).toBe(404);
    }
  });

  it("throws ApiError on timeout", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        const err = new DOMException("The operation was aborted", "AbortError");
        // Simulate abort after a short delay
        setTimeout(() => reject(err), 10);
      });
    });
    const client = createClient({ timeout: 50 });

    await expect(client.get("/slow")).rejects.toThrow(ApiError);
  });

  it("DELETE returns void", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
      headers: new Headers(),
      json: () => Promise.reject(new Error("no body")),
    });
    const client = createClient();

    const result = await client.delete("/contacts/123");
    expect(result).toBeUndefined();
  });

  it("getPaginated iterates pages", async () => {
    const page1 = {
      page: { size: 2, totalElements: 4, totalPages: 2, number: 0 },
      content: [{ id: "1" }, { id: "2" }],
    };
    const page2 = {
      page: { size: 2, totalElements: 4, totalPages: 2, number: 1 },
      content: [{ id: "3" }, { id: "4" }],
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
    for await (const items of client.getPaginated("/companies")) {
      allItems.push(...items);
    }

    expect(allItems).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("debug mode logs to stderr", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    globalThis.fetch = mockFetchResponse(200, { ok: true });
    const client = createClient({ debug: true });

    await client.get("/test");

    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("GET");
    expect(output).toContain("/test");
  });
});

describe("getDefaultBaseUrl", () => {
  const originalApiBase = process.env.PAX8_API_BASE;

  afterEach(() => {
    if (originalApiBase === undefined) delete process.env.PAX8_API_BASE;
    else process.env.PAX8_API_BASE = originalApiBase;
  });

  it("falls back to the production URL when PAX8_API_BASE is unset", () => {
    delete process.env.PAX8_API_BASE;
    expect(getDefaultBaseUrl()).toBe("https://api.pax8.com/v1");
  });

  it("falls back to the production URL when PAX8_API_BASE is empty string", () => {
    process.env.PAX8_API_BASE = "";
    expect(getDefaultBaseUrl()).toBe("https://api.pax8.com/v1");
  });

  it("honors PAX8_API_BASE when set", () => {
    process.env.PAX8_API_BASE = "https://api-staging.pax8.com/v1";
    expect(getDefaultBaseUrl()).toBe("https://api-staging.pax8.com/v1");
  });

  it("re-reads the env on every call (lazy lookup, not cached)", () => {
    delete process.env.PAX8_API_BASE;
    expect(getDefaultBaseUrl()).toBe("https://api.pax8.com/v1");

    process.env.PAX8_API_BASE = "https://example.test/v1";
    expect(getDefaultBaseUrl()).toBe("https://example.test/v1");

    process.env.PAX8_API_BASE = "https://other.test/v2";
    expect(getDefaultBaseUrl()).toBe("https://other.test/v2");

    delete process.env.PAX8_API_BASE;
    expect(getDefaultBaseUrl()).toBe("https://api.pax8.com/v1");
  });
});

describe("Pax8Client + PAX8_API_BASE", () => {
  let originalFetch: typeof globalThis.fetch;
  const originalApiBase = process.env.PAX8_API_BASE;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockTokenManager.getToken.mockResolvedValue("test-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalApiBase === undefined) delete process.env.PAX8_API_BASE;
    else process.env.PAX8_API_BASE = originalApiBase;
  });

  it("uses PAX8_API_BASE for the request URL when no explicit baseUrl is passed", async () => {
    process.env.PAX8_API_BASE = "https://api-staging.pax8.com/v1";
    globalThis.fetch = mockFetchResponse(200, {});
    const client = new Pax8Client({
      tokenManager: mockTokenManager,
      cacheTtlMs: 0,
    });

    await client.get("/companies");

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url.toString()).toContain("https://api-staging.pax8.com/v1/companies");
  });

  it("strips trailing slashes from PAX8_API_BASE before composing the URL", async () => {
    process.env.PAX8_API_BASE = "https://api-staging.pax8.com/v1//";
    globalThis.fetch = mockFetchResponse(200, {});
    const client = new Pax8Client({
      tokenManager: mockTokenManager,
      cacheTtlMs: 0,
    });

    await client.get("/companies");

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    // Should not double up slashes between base and path
    expect(url.toString()).toBe("https://api-staging.pax8.com/v1/companies");
  });

  it("explicit baseUrl option overrides PAX8_API_BASE", async () => {
    process.env.PAX8_API_BASE = "https://api-staging.pax8.com/v1";
    globalThis.fetch = mockFetchResponse(200, {});
    const client = new Pax8Client({
      tokenManager: mockTokenManager,
      baseUrl: "https://api.example.com/v1",
      cacheTtlMs: 0,
    });

    await client.get("/companies");

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url.toString()).toContain("https://api.example.com/v1/companies");
    expect(url.toString()).not.toContain("staging");
  });
});

// #234 — `validateBaseUrl` blocks plaintext URLs that would leak bearer
// tokens; loopback addresses and the `PAX8_ALLOW_INSECURE_BASE=1` opt-in
// remain accepted.
describe("validateBaseUrl (#234)", () => {
  const originalAllow = process.env.PAX8_ALLOW_INSECURE_BASE;

  afterEach(() => {
    if (originalAllow === undefined) delete process.env.PAX8_ALLOW_INSECURE_BASE;
    else process.env.PAX8_ALLOW_INSECURE_BASE = originalAllow;
  });

  it("accepts a normal https URL as-is", () => {
    expect(validateBaseUrl("https://api.pax8.com/v1")).toBe(
      "https://api.pax8.com/v1",
    );
  });

  it("rejects http://non-loopback hosts", () => {
    let thrown: unknown;
    try {
      validateBaseUrl("http://api.example.com/v1");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Pax8SecurityError);
    expect((thrown as Pax8SecurityError).code).toBe(ERROR_INVALID_INPUT);
    // Recovery steps must mention the escape hatch so the user knows how
    // to bypass when they're sure.
    const steps = (thrown as Pax8SecurityError).recoverySteps?.join("\n") ?? "";
    expect(steps).toContain("PAX8_ALLOW_INSECURE_BASE");
    expect(steps).toContain("https://");
  });

  it("accepts http://localhost variants (loopback)", () => {
    expect(validateBaseUrl("http://localhost:8080")).toBe(
      "http://localhost:8080",
    );
    expect(validateBaseUrl("http://127.0.0.1:8080")).toBe(
      "http://127.0.0.1:8080",
    );
    expect(validateBaseUrl("http://[::1]:8080")).toBe("http://[::1]:8080");
    // *.localhost is also loopback per RFC 6761.
    expect(validateBaseUrl("http://api.localhost:9000")).toBe(
      "http://api.localhost:9000",
    );
  });

  it("accepts http://non-localhost when PAX8_ALLOW_INSECURE_BASE=1 and emits a stderr warning", () => {
    process.env.PAX8_ALLOW_INSECURE_BASE = "1";
    const writeSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const result = validateBaseUrl("http://attacker.example.com");
      expect(result).toBe("http://attacker.example.com");
      // Loud warning, on every call.
      const calls = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(calls).toContain("WARNING");
      expect(calls).toContain("attacker.example.com");
      // Red-bold ANSI prefix is present (chalk equivalent).
      expect(calls).toContain("\x1b[1m\x1b[31m");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("throws a helpful error on unparseable input", () => {
    let thrown: unknown;
    try {
      // Plain garbage with no scheme and no host — `new URL()` rejects this.
      validateBaseUrl("definitely not a url");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Pax8SecurityError);
    expect((thrown as Pax8SecurityError).message).toContain("Invalid PAX8_API_BASE");
    expect((thrown as Pax8SecurityError).recoverySteps?.length).toBeGreaterThan(0);
  });

  it("rejects unsupported protocols (e.g. ftp://)", () => {
    expect(() => validateBaseUrl("ftp://example.com/v1")).toThrow(
      Pax8SecurityError,
    );
  });

  it("getDefaultBaseUrl rejects a malicious http:// PAX8_API_BASE", () => {
    const original = process.env.PAX8_API_BASE;
    process.env.PAX8_API_BASE = "http://attacker.example.com";
    try {
      expect(() => getDefaultBaseUrl()).toThrow(Pax8SecurityError);
    } finally {
      if (original === undefined) delete process.env.PAX8_API_BASE;
      else process.env.PAX8_API_BASE = original;
    }
  });
});

// #263 — debug-mode error response bodies must not echo bearer tokens or
// secrets; `PAX8_DEBUG_RAW=1` is the escape hatch for actual debugging.
describe("redactDebugBody (#263)", () => {
  const originalRaw = process.env.PAX8_DEBUG_RAW;

  afterEach(() => {
    if (originalRaw === undefined) delete process.env.PAX8_DEBUG_RAW;
    else process.env.PAX8_DEBUG_RAW = originalRaw;
  });

  it("redacts a Bearer token in the body", () => {
    const out = redactDebugBody(
      'unauthorized: "Bearer abc123XYZdef456_token-value-here"',
    );
    expect(out).toContain("Bearer <REDACTED:TOKEN>");
    expect(out).not.toContain("abc123XYZdef456");
  });

  it("redacts a JWT-shaped token", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = redactDebugBody(`token=${jwt}`);
    expect(out).toContain("<REDACTED:JWT>");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it('redacts client_secret values regardless of quoting', () => {
    const out = redactDebugBody('{"client_secret": "abc123def456ghi789jkl"}');
    expect(out).not.toContain("abc123def456ghi789jkl");
    expect(out).toContain("<REDACTED:TOKEN>");
  });

  it("logs short, plain error bodies verbatim", () => {
    const plain = '{"error": "company not found", "id": "ACME"}';
    expect(redactDebugBody(plain)).toBe(plain);
  });

  it("truncates bodies longer than 500 chars", () => {
    // Use a simple repeated phrase that won't trip the opaque-token rule
    // (alpha-only, with spaces and short words). The `xxxx` block alone
    // would be redacted to `<REDACTED:TOKEN>` and become *shorter* than
    // 500 chars, so we need natural-looking padding.
    const big = "the quick brown fox jumps over the lazy dog ".repeat(40);
    const out = redactDebugBody(big);
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain("truncated");
  });

  it("PAX8_DEBUG_RAW=1 returns the body unredacted", () => {
    process.env.PAX8_DEBUG_RAW = "1";
    const sensitive = 'Bearer abc123XYZdef456_token-value-here';
    expect(redactDebugBody(sensitive)).toBe(sensitive);
  });
});

// Integration: when debug=true and the API returns an error body containing
// a Bearer token, the stderr trail must not contain the raw token.
describe("Pax8Client debug error logging (#263)", () => {
  let originalFetch: typeof globalThis.fetch;
  const originalRaw = process.env.PAX8_DEBUG_RAW;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockTokenManager.getToken.mockResolvedValue("test-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalRaw === undefined) delete process.env.PAX8_DEBUG_RAW;
    else process.env.PAX8_DEBUG_RAW = originalRaw;
  });

  it("redacts a Bearer token in a 4xx error body when debug=true", async () => {
    globalThis.fetch = mockFetchResponse(401, {
      error: "unauthorized",
      hint: "Bearer abc123XYZdef456_real-token-value",
    });
    const client = new Pax8Client({
      tokenManager: mockTokenManager,
      baseUrl: "https://api.pax8.com/v1",
      debug: true,
      cacheTtlMs: 0,
    });
    const writeSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await client.get("/companies").catch(() => undefined);
      const all = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(all).toContain("error body:");
      expect(all).toContain("<REDACTED:TOKEN>");
      expect(all).not.toContain("abc123XYZdef456");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("PAX8_DEBUG_RAW=1 keeps the raw body in debug logs", async () => {
    process.env.PAX8_DEBUG_RAW = "1";
    globalThis.fetch = mockFetchResponse(400, {
      detail: "Bearer abc123XYZdef456_real-token-value",
    });
    const client = new Pax8Client({
      tokenManager: mockTokenManager,
      baseUrl: "https://api.pax8.com/v1",
      debug: true,
      cacheTtlMs: 0,
    });
    const writeSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await client.get("/companies").catch(() => undefined);
      const all = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(all).toContain("abc123XYZdef456");
    } finally {
      writeSpy.mockRestore();
    }
  });
});
