// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { ApiError, AuthError, RateLimitError, NotFoundError, ValidationError } from "./errors.js";

describe("ApiError", () => {
  it("stores all properties", () => {
    const err = new ApiError("Server error", 500, "/companies", "GET", { message: "fail" });
    expect(err.message).toBe("Server error");
    expect(err.statusCode).toBe(500);
    expect(err.requestPath).toBe("/companies");
    expect(err.requestMethod).toBe("GET");
    expect(err.responseBody).toEqual({ message: "fail" });
    expect(err.name).toBe("ApiError");
    expect(err instanceof Error).toBe(true);
  });

  it("works without optional fields", () => {
    const err = new ApiError("Error", 400, "/test");
    expect(err.requestMethod).toBeUndefined();
    expect(err.responseBody).toBeUndefined();
  });
});

describe("AuthError", () => {
  it("defaults to 401 and /v1/token path", () => {
    const err = new AuthError("Unauthorized");
    expect(err.statusCode).toBe(401);
    expect(err.requestPath).toBe("/v1/token");
    expect(err.requestMethod).toBe("POST");
    expect(err.name).toBe("AuthError");
    expect(err instanceof ApiError).toBe(true);
  });

  it("accepts custom statusCode", () => {
    const err = new AuthError("Forbidden", 403);
    expect(err.statusCode).toBe(403);
  });
});

describe("RateLimitError", () => {
  it("stores retryAfterMs", () => {
    const err = new RateLimitError("Rate limited", "/companies", 60000, "GET");
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterMs).toBe(60000);
    expect(err.requestPath).toBe("/companies");
    expect(err.requestMethod).toBe("GET");
    expect(err.name).toBe("RateLimitError");
    expect(err instanceof ApiError).toBe(true);
  });
});

describe("NotFoundError", () => {
  it("formats message with resource and id", () => {
    const err = new NotFoundError("Company", "abc-123");
    expect(err.message).toBe("Company not found: abc-123");
    expect(err.statusCode).toBe(404);
    expect(err.requestPath).toBe("/companys/abc-123");
    expect(err.name).toBe("NotFoundError");
    expect(err instanceof ApiError).toBe(true);
  });

  it("accepts custom request path", () => {
    const err = new NotFoundError("Subscription", "id-1", "/subscriptions/id-1");
    expect(err.requestPath).toBe("/subscriptions/id-1");
  });
});

describe("ValidationError", () => {
  it("stores field errors", () => {
    const fieldErrors = [
      { field: "name", message: "required" },
      { field: "email", message: "invalid format" },
    ];
    const err = new ValidationError("Validation failed", fieldErrors);
    expect(err.message).toBe("Validation failed");
    expect(err.name).toBe("ValidationError");
    expect(err.fieldErrors).toHaveLength(2);
    expect(err.fieldErrors[0].field).toBe("name");
    expect(err instanceof Error).toBe(true);
  });

  it("defaults to empty field errors", () => {
    const err = new ValidationError("Bad input");
    expect(err.fieldErrors).toEqual([]);
  });
});
