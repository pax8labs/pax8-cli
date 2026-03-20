import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenManager } from "./token-manager.js";
import { AuthError } from "../api/errors.js";

const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";

function createManager() {
  return new TokenManager({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
}

describe("TokenManager — extended coverage", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws AuthError with message field when no error_description or error", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "bad request" }), { status: 400 })
    );

    const manager = createManager();
    const error = await manager.getToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).message).toContain("bad request");
  });

  it("throws AuthError with default message when response body has no known fields", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ unknown: "field" }), { status: 400 })
    );

    const manager = createManager();
    const error = await manager.getToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).message).toContain("Authentication failed (HTTP 400)");
  });

  it("throws AuthError when response is not valid JSON on error", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("not json at all", { status: 401, headers: { "Content-Type": "text/plain" } })
    );

    const manager = createManager();
    const error = await manager.getToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).message).toContain("Authentication failed (HTTP 401)");
  });

  it("throws AuthError when response body JSON cannot be parsed on success", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("invalid json")),
    } as unknown as Response);

    const manager = createManager();
    const error = await manager.getToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).message).toContain("could not parse JSON");
  });

  it("throws AuthError when non-Error is thrown by fetch", async () => {
    fetchSpy.mockRejectedValueOnce("string error");

    const manager = createManager();
    const error = await manager.getToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).message).toContain("string error");
  });
});
