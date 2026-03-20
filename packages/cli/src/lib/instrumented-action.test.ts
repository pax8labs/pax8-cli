import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyError, instrumentedAction } from "./instrumented-action.js";
import { AuthError, RateLimitError, ValidationError, ApiError } from "@pax8/core";

describe("classifyError", () => {
  it("classifies AuthError", () => {
    expect(classifyError(new AuthError("fail"))).toBe("AUTH_FAILED");
  });

  it("classifies RateLimitError", () => {
    expect(classifyError(new RateLimitError("rate", "/test", 1000))).toBe("RATE_LIMITED");
  });

  it("classifies ValidationError", () => {
    expect(classifyError(new ValidationError("invalid"))).toBe("VALIDATION_ERROR");
  });

  it("classifies ApiError with 404 as NOT_FOUND", () => {
    expect(classifyError(new ApiError("not found", 404, "/test"))).toBe("NOT_FOUND");
  });

  it("classifies ApiError with non-404 as API_ERROR", () => {
    expect(classifyError(new ApiError("server error", 500, "/test"))).toBe("API_ERROR");
  });

  it("classifies network errors", () => {
    expect(classifyError(new Error("ECONNREFUSED"))).toBe("NETWORK_ERROR");
    expect(classifyError(new Error("ENOTFOUND"))).toBe("NETWORK_ERROR");
    expect(classifyError(new Error("ETIMEDOUT"))).toBe("NETWORK_ERROR");
    expect(classifyError(new Error("fetch failed"))).toBe("NETWORK_ERROR");
    expect(classifyError(new Error("network error occurred"))).toBe("NETWORK_ERROR");
  });

  it("classifies unknown errors", () => {
    expect(classifyError(new Error("something else"))).toBe("UNKNOWN");
    expect(classifyError("string error")).toBe("UNKNOWN");
    expect(classifyError(null)).toBe("UNKNOWN");
    expect(classifyError(undefined)).toBe("UNKNOWN");
  });
});

describe("instrumentedAction", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.PAX8_DEMO;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("calls the wrapped action", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const wrapped = instrumentedAction("test.command", action);

    await wrapped({ json: true, verbose: false });

    expect(action).toHaveBeenCalledWith({ json: true, verbose: false });
  });

  it("re-throws errors from the action", async () => {
    const error = new Error("test error");
    const action = vi.fn().mockRejectedValue(error);
    const wrapped = instrumentedAction("test.command", action);

    await expect(wrapped({})).rejects.toThrow("test error");
  });
});
