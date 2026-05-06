import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyError, instrumentedAction } from "./instrumented-action.js";
import { CliError } from "./errors.js";
import {
  AuthError,
  RateLimitError,
  ValidationError,
  ApiError,
  ERROR_AUTH_EXPIRED,
  ERROR_RATE_LIMITED,
  ERROR_API_VALIDATION,
  ERROR_API_TIMEOUT,
  ERROR_NOT_AUTHORIZED,
  ERROR_NOT_FOUND,
  ERROR_INTERNAL,
  ERROR_COMPANY_NOT_FOUND,
} from "@pax8/core";

describe("classifyError", () => {
  it("classifies AuthError as ERROR_AUTH_EXPIRED", () => {
    expect(classifyError(new AuthError("fail"))).toBe(ERROR_AUTH_EXPIRED);
  });

  it("classifies RateLimitError as ERROR_RATE_LIMITED", () => {
    expect(classifyError(new RateLimitError("rate", "/test", 1000))).toBe(ERROR_RATE_LIMITED);
  });

  it("classifies ValidationError as ERROR_API_VALIDATION", () => {
    expect(classifyError(new ValidationError("invalid"))).toBe(ERROR_API_VALIDATION);
  });

  it("classifies ApiError with 404 as ERROR_NOT_FOUND", () => {
    expect(classifyError(new ApiError("not found", 404, "/test"))).toBe(ERROR_NOT_FOUND);
  });

  it("classifies ApiError with 401 as ERROR_AUTH_EXPIRED", () => {
    expect(classifyError(new ApiError("unauthorized", 401, "/test"))).toBe(ERROR_AUTH_EXPIRED);
  });

  it("classifies ApiError with 408 as ERROR_API_TIMEOUT", () => {
    expect(classifyError(new ApiError("timeout", 408, "/test"))).toBe(ERROR_API_TIMEOUT);
  });

  it("classifies ApiError with 429 as ERROR_RATE_LIMITED", () => {
    expect(classifyError(new ApiError("rate", 429, "/test"))).toBe(ERROR_RATE_LIMITED);
  });

  it("classifies ApiError with 5xx as ERROR_INTERNAL", () => {
    expect(classifyError(new ApiError("server error", 500, "/test"))).toBe(ERROR_INTERNAL);
  });

  it("prefers CliError.code when present", () => {
    const err = new CliError("missing", undefined, undefined, undefined, ERROR_COMPANY_NOT_FOUND);
    expect(classifyError(err)).toBe(ERROR_COMPANY_NOT_FOUND);
  });

  it("classifies network errors as ERROR_API_TIMEOUT", () => {
    expect(classifyError(new Error("ECONNREFUSED"))).toBe(ERROR_API_TIMEOUT);
    expect(classifyError(new Error("ENOTFOUND"))).toBe(ERROR_API_TIMEOUT);
    expect(classifyError(new Error("ETIMEDOUT"))).toBe(ERROR_API_TIMEOUT);
    expect(classifyError(new Error("fetch failed"))).toBe(ERROR_API_TIMEOUT);
    expect(classifyError(new Error("network error occurred"))).toBe(ERROR_API_TIMEOUT);
  });

  it("classifies unknown errors as ERROR_INTERNAL", () => {
    expect(classifyError(new Error("something else"))).toBe(ERROR_INTERNAL);
    expect(classifyError("string error")).toBe(ERROR_INTERNAL);
    expect(classifyError(null)).toBe(ERROR_INTERNAL);
    expect(classifyError(undefined)).toBe(ERROR_INTERNAL);
  });

  it("returns values that match the ERROR_* vocabulary", () => {
    const allowed = new Set([
      ERROR_AUTH_EXPIRED,
      ERROR_RATE_LIMITED,
      ERROR_API_VALIDATION,
      ERROR_API_TIMEOUT,
      ERROR_NOT_AUTHORIZED,
      ERROR_NOT_FOUND,
      ERROR_INTERNAL,
      ERROR_COMPANY_NOT_FOUND,
    ]);
    const samples: unknown[] = [
      new AuthError("x"),
      new RateLimitError("x", "/p", 1),
      new ValidationError("x"),
      new ApiError("x", 404, "/p"),
      new ApiError("x", 500, "/p"),
      new Error("ECONNREFUSED"),
      new Error("anything"),
      "raw string",
      null,
    ];
    for (const s of samples) {
      const code = classifyError(s);
      expect(allowed.has(code)).toBe(true);
      expect(code).toMatch(/^ERROR_[A-Z_]+$/);
    }
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
