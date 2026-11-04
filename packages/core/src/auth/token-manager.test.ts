// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenManager } from "./token-manager.js";
import { AuthError } from "../api/errors.js";
import { Pax8SecurityError } from "../security/validate-env.js";
import {
  TokenCacheStore,
  computeCacheIdentity,
  type TokenCacheFile,
} from "./token-cache-store.js";

const MOCK_TOKEN = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.mock-token";
const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";

/**
 * In-memory `TokenCacheStore` stand-in. Lets each test exercise the
 * TokenManager flow without touching the real filesystem. The pre-#233
 * tests in this file are about in-memory cache behavior, so we wire a
 * fresh empty stub for every test — anything that needs to assert on
 * disk-write semantics is covered in `token-cache-store.test.ts`.
 */
class StubCacheStore extends TokenCacheStore {
  public entry: TokenCacheFile | null = null;
  public saveCount = 0;
  public clearCount = 0;
  override load(key: { clientId: string; apiBaseUrl: string }): TokenCacheFile | null {
    if (!this.entry) return null;
    // Mirror the real store's identity-match contract so the manager's
    // hash-mismatch tests exercise the same code path.
    const expected = computeCacheIdentity(key);
    if (
      this.entry.clientIdHash !== expected.clientIdHash ||
      this.entry.apiBaseHash !== expected.apiBaseHash
    ) {
      return null;
    }
    return this.entry;
  }
  override async save(entry: TokenCacheFile): Promise<void> {
    this.entry = entry;
    this.saveCount++;
  }
  override clear(): void {
    this.entry = null;
    this.clearCount++;
  }
}

function createManager(cacheStore: TokenCacheStore = new StubCacheStore()) {
  return new TokenManager({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, cacheStore });
}

describe("TokenManager", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches a token and returns it", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN }), { status: 200 })
    );

    const manager = createManager();
    const token = await manager.getToken();

    expect(token).toBe(MOCK_TOKEN);
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.pax8.com/v1/token");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
      audience: "https://api.pax8.com",
    });
  });

  it("caches the token and does not refetch", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN }), { status: 200 })
    );

    const manager = createManager();
    const token1 = await manager.getToken();
    const token2 = await manager.getToken();

    expect(token1).toBe(MOCK_TOKEN);
    expect(token2).toBe(MOCK_TOKEN);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("throws AuthError on 401 response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error_description: "Invalid client credentials" }), {
        status: 401,
      })
    );

    const manager = createManager();
    const error = await manager.getToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).message).toContain("Invalid client credentials");
    expect((error as AuthError).statusCode).toBe(401);
  });

  it("throws AuthError with error field when no error_description", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unauthorized_client" }), { status: 403 })
    );

    const manager = createManager();
    await expect(manager.getToken()).rejects.toThrow("unauthorized_client");
  });

  it("throws AuthError on network error", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("fetch failed"));

    const manager = createManager();
    const error = await manager.getToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).message).toContain("Failed to connect to Pax8 auth server");
    expect((error as AuthError).message).toContain("fetch failed");
  });

  it("refreshes token when remaining lifetime drops inside the skew buffer", async () => {
    // #233 — the refresh buffer is now `min(60s, 10% of ttl)`. For a 24 h
    // production token that's 60 s. Advance past `24h - 60s + 1s` so the
    // freshness check trips and the manager refetches.
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token-1", expires_in: 86400 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token-2", expires_in: 86400 }), { status: 200 })
      );

    const manager = createManager();
    const token1 = await manager.getToken();
    expect(token1).toBe("token-1");

    // Twenty-four hours minus 59 seconds elapsed: the token has 59 s left,
    // which is *inside* the 60 s skew buffer. Manager must refetch.
    const ALMOST_FULL_TTL = 24 * 60 * 60 * 1000 - 59 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + ALMOST_FULL_TTL);

    const token2 = await manager.getToken();
    expect(token2).toBe("token-2");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT refresh when remaining lifetime exceeds the skew buffer", async () => {
    // Symmetric to the above: at 23 h elapsed on a 24 h token, we have 1 h
    // remaining — well outside the 60 s buffer. The old (pre-#233) flat
    // 1 h buffer would have refreshed here; the new policy must not.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN, expires_in: 86400 }), { status: 200 })
    );

    const manager = createManager();
    await manager.getToken();

    const TWENTY_THREE_HOURS = 23 * 60 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + TWENTY_THREE_HOURS);

    const token2 = await manager.getToken();
    expect(token2).toBe(MOCK_TOKEN);
    // Only one fetch — the cache was still fresh.
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("isAuthenticated() returns false initially", () => {
    const manager = createManager();
    expect(manager.isAuthenticated()).toBe(false);
  });

  it("isAuthenticated() returns true after fetching token", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN }), { status: 200 })
    );

    const manager = createManager();
    await manager.getToken();
    expect(manager.isAuthenticated()).toBe(true);
  });

  it("isAuthenticated() returns false after token enters the skew buffer", async () => {
    // #233 — buffer is now 60 s on a 24 h Pax8 token. Advance to inside
    // the buffer (24h - 59s) and the cache flips to "stale."
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN, expires_in: 86400 }), { status: 200 })
    );

    const manager = createManager();
    await manager.getToken();
    expect(manager.isAuthenticated()).toBe(true);

    const ALMOST_FULL_TTL = 24 * 60 * 60 * 1000 - 59 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + ALMOST_FULL_TTL);

    expect(manager.isAuthenticated()).toBe(false);
  });

  it("clearToken() removes cached token", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN }), { status: 200 })
    );

    const manager = createManager();
    await manager.getToken();
    expect(manager.isAuthenticated()).toBe(true);

    manager.clearToken();
    expect(manager.isAuthenticated()).toBe(false);
  });

  it("throws AuthError when response has no access_token", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ token_type: "bearer" }), { status: 200 })
    );

    const manager = createManager();
    await expect(manager.getToken()).rejects.toThrow("missing access_token");
  });

  it("deduplicates concurrent requests", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN }), { status: 200 })
    );

    const manager = createManager();
    const [t1, t2, t3] = await Promise.all([
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
    ]);

    expect(t1).toBe(MOCK_TOKEN);
    expect(t2).toBe(MOCK_TOKEN);
    expect(t3).toBe(MOCK_TOKEN);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

describe("TokenManager + PAX8_API_BASE", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const originalApiBase = process.env.PAX8_API_BASE;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalApiBase === undefined) delete process.env.PAX8_API_BASE;
    else process.env.PAX8_API_BASE = originalApiBase;
  });

  it("derives the token URL from PAX8_API_BASE when set", async () => {
    process.env.PAX8_API_BASE = "https://api-staging.pax8.com/v1";
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN }), { status: 200 })
    );

    const manager = createManager();
    await manager.getToken();

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api-staging.pax8.com/v1/token");
  });

  it("uses the production token URL when PAX8_API_BASE is unset", async () => {
    delete process.env.PAX8_API_BASE;
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN }), { status: 200 })
    );

    const manager = createManager();
    await manager.getToken();

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.pax8.com/v1/token");
  });

  it("normalizes a trailing slash on PAX8_API_BASE before appending /token", async () => {
    process.env.PAX8_API_BASE = "https://api-staging.pax8.com/v1/";
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN }), { status: 200 })
    );

    const manager = createManager();
    await manager.getToken();

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    // The trailing slash must NOT result in `//token`.
    expect(url).toBe("https://api-staging.pax8.com/v1/token");
  });

  it("normalizes multiple trailing slashes on PAX8_API_BASE", async () => {
    process.env.PAX8_API_BASE = "https://api-staging.pax8.com/v1///";
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN }), { status: 200 })
    );

    const manager = createManager();
    await manager.getToken();

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api-staging.pax8.com/v1/token");
  });
});

// #234 — getDefaultBaseUrl() now validates PAX8_API_BASE; TokenManager
// inherits the check because it derives the /token URL from the same
// helper. A malicious http:// host must NOT receive POSTs of client_id /
// client_secret.
describe("TokenManager + PAX8_API_BASE security (#234)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const originalApiBase = process.env.PAX8_API_BASE;
  const originalAllow = process.env.PAX8_ALLOW_INSECURE_BASE;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalApiBase === undefined) delete process.env.PAX8_API_BASE;
    else process.env.PAX8_API_BASE = originalApiBase;
    if (originalAllow === undefined) delete process.env.PAX8_ALLOW_INSECURE_BASE;
    else process.env.PAX8_ALLOW_INSECURE_BASE = originalAllow;
  });

  it("refuses to fetch a token from a plaintext http:// host", async () => {
    process.env.PAX8_API_BASE = "http://attacker.example.com";
    const manager = createManager();
    await expect(manager.getToken()).rejects.toBeInstanceOf(Pax8SecurityError);
    // Critically: fetch must NOT have been called — credentials never
    // leave the process.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows http://localhost (loopback dev)", async () => {
    process.env.PAX8_API_BASE = "http://localhost:8080";
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN }), { status: 200 })
    );
    const manager = createManager();
    const token = await manager.getToken();
    expect(token).toBe(MOCK_TOKEN);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8080/token");
  });

  it("allows http://attacker with PAX8_ALLOW_INSECURE_BASE=1 (escape hatch)", async () => {
    process.env.PAX8_API_BASE = "http://test-rig.example.com";
    process.env.PAX8_ALLOW_INSECURE_BASE = "1";
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN }), { status: 200 })
    );
    // Silence the loud stderr warning for this test.
    const writeSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const manager = createManager();
      const token = await manager.getToken();
      expect(token).toBe(MOCK_TOKEN);
    } finally {
      writeSpy.mockRestore();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// #233 — persistent on-disk token cache
// ──────────────────────────────────────────────────────────────────────────

describe("TokenManager + on-disk cache (#233)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates the in-memory cache from a fresh-enough disk entry without re-fetching", async () => {
    const store = new StubCacheStore();
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    store.entry = {
      accessToken: "from-disk",
      expiresAt: Date.now() + TWELVE_HOURS,
      ttlMs: 24 * 60 * 60 * 1000,
      // Hash format must match what the manager computes for the test
      // creds; verify the round-trip explicitly via the helper.
      clientIdHash: "",
      apiBaseHash: "",
    };
    // Compute the correct hashes via the same helper the manager uses.
    const id = computeCacheIdentity({ clientId: CLIENT_ID, apiBaseUrl: "https://api.pax8.com/v1" });
    store.entry.clientIdHash = id.clientIdHash;
    store.entry.apiBaseHash = id.apiBaseHash;

    const manager = createManager(store);
    const token = await manager.getToken();

    expect(token).toBe("from-disk");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores a disk entry whose clientIdHash does not match (credential rotation)", async () => {
    const store = new StubCacheStore();
    store.entry = {
      accessToken: "from-disk",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      ttlMs: 24 * 60 * 60 * 1000,
      clientIdHash: "not-the-current-hash",
      apiBaseHash: "not-the-current-hash",
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "fresh", expires_in: 86400 }), { status: 200 })
    );

    const manager = createManager(store);
    const token = await manager.getToken();

    // Disk entry rejected on identity mismatch; manager refetched.
    expect(token).toBe("fresh");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("persists a fresh token to the cache store after fetch", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN, expires_in: 86400 }), { status: 200 })
    );

    const store = new StubCacheStore();
    const manager = createManager(store);
    await manager.getToken();
    // The save call is fire-and-forget inside fetchToken; the stub
    // updates synchronously inside `save`, so a microtask flush is
    // enough to observe it.
    await Promise.resolve();

    expect(store.saveCount).toBe(1);
    expect(store.entry?.accessToken).toBe(MOCK_TOKEN);
    expect(store.entry?.ttlMs).toBe(86400 * 1000);
    // The expiry should land in the future, roughly TTL away.
    expect(store.entry?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("falls back to the 24h default when /token omits expires_in", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN }), { status: 200 })
    );

    const store = new StubCacheStore();
    const manager = createManager(store);
    await manager.getToken();
    await Promise.resolve();

    expect(store.entry?.ttlMs).toBe(24 * 60 * 60 * 1000);
  });

  it("clearCache() wipes the on-disk entry and forces a refetch", async () => {
    const store = new StubCacheStore();
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "first", expires_in: 86400 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "second", expires_in: 86400 }), { status: 200 })
      );

    const manager = createManager(store);
    expect(await manager.getToken()).toBe("first");
    await Promise.resolve();
    expect(store.entry?.accessToken).toBe("first");

    manager.clearCache();
    expect(store.clearCount).toBe(1);
    expect(store.entry).toBeNull();

    // Even though we'd otherwise hit the in-memory cache, `forceRefetch`
    // forces the network round trip.
    expect(await manager.getToken()).toBe("second");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("clearCache() does not throw when the disk clear fails", async () => {
    class ThrowingStore extends TokenCacheStore {
      override load(): null {
        return null;
      }
      override async save(): Promise<void> {
        // no-op
      }
      override clear(): never {
        throw new Error("EPERM: simulated");
      }
    }

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN, expires_in: 86400 }), { status: 200 })
    );

    const manager = new TokenManager({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      cacheStore: new ThrowingStore(),
    });
    await manager.getToken();

    // Must not throw.
    expect(() => manager.clearCache()).not.toThrow();
    // In-memory still cleared.
    expect(manager.isAuthenticated()).toBe(false);
  });

  it("clearToken() does NOT touch the on-disk cache (back-compat)", async () => {
    const store = new StubCacheStore();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN, expires_in: 86400 }), { status: 200 })
    );

    const manager = createManager(store);
    await manager.getToken();
    await Promise.resolve();
    expect(store.entry).not.toBeNull();

    manager.clearToken();
    // On-disk untouched.
    expect(store.clearCount).toBe(0);
    expect(store.entry).not.toBeNull();
  });
});
