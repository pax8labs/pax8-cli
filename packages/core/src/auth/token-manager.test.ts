import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenManager } from "./token-manager.js";
import { AuthError } from "../api/errors.js";

const MOCK_TOKEN = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.mock-token";
const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";

function createManager() {
  return new TokenManager({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
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

  it("refreshes token when expired (past 23h)", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token-1" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token-2" }), { status: 200 })
      );

    const manager = createManager();
    const token1 = await manager.getToken();
    expect(token1).toBe("token-1");

    // Advance time past the 23h refresh threshold
    const TWENTY_THREE_HOURS = 23 * 60 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + TWENTY_THREE_HOURS + 1000);

    const token2 = await manager.getToken();
    expect(token2).toBe("token-2");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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

  it("isAuthenticated() returns false after token expires", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: MOCK_TOKEN }), { status: 200 })
    );

    const manager = createManager();
    await manager.getToken();
    expect(manager.isAuthenticated()).toBe(true);

    const TWENTY_THREE_HOURS = 23 * 60 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + TWENTY_THREE_HOURS + 1000);

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
