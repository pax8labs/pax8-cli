import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import {
  ApiError,
  ERROR_AUTH_EXPIRED,
  ERROR_API_TIMEOUT,
  ERROR_API_VALIDATION,
  ERROR_COMPANY_NOT_FOUND,
  ERROR_INTERNAL,
  ERROR_NOT_AUTHORIZED,
  ERROR_PRODUCT_NOT_FOUND,
  ERROR_RATE_LIMITED,
  ERROR_SUBSCRIPTION_NOT_FOUND,
} from "@pax8/core";
import { CliError, handleCommandError, extractErrorDetail } from "./errors.js";

describe("CliError", () => {
  it("constructs with message only", () => {
    const err = new CliError("Something went wrong");
    expect(err.message).toBe("Something went wrong");
    expect(err.name).toBe("CliError");
    expect(err.causes).toBeUndefined();
    expect(err.recoverySteps).toBeUndefined();
    expect(err.docsUrl).toBeUndefined();
  });

  it("constructs with all options", () => {
    const err = new CliError(
      "Auth failed",
      ["Invalid credentials", "Token expired"],
      ["Run pax8 auth login", "Check your client ID"],
      "https://docs.pax8.com/auth"
    );
    expect(err.message).toBe("Auth failed");
    expect(err.causes).toEqual(["Invalid credentials", "Token expired"]);
    expect(err.recoverySteps).toEqual([
      "Run pax8 auth login",
      "Check your client ID",
    ]);
    expect(err.docsUrl).toBe("https://docs.pax8.com/auth");
  });

  it("is an instance of Error", () => {
    const err = new CliError("test");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof CliError).toBe(true);
  });
});

describe("handleCommandError", () => {
  let stderrWrite: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    stderrWrite.mockRestore();
    exitSpy.mockRestore();
  });

  // handleCommandError calls process.exit(1) then throws "process.exit intercepted"
  // We need to catch the throw to inspect stderr output and exit spy

  it("formats CliError with message", () => {
    expect(() => handleCommandError(new CliError("Something broke"))).toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Something broke");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("formats CliError with causes and recovery steps", () => {
    expect(() => handleCommandError(
      new CliError(
        "Auth failed",
        ["Token expired"],
        ["Run pax8 auth login"]
      )
    )).toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Auth failed");
    expect(written).toContain("Token expired");
    expect(written).toContain("Run pax8 auth login");
  });

  it("formats CliError with docs URL", () => {
    expect(() => handleCommandError(
      new CliError("Error", undefined, undefined, "https://example.com/docs")
    )).toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("https://example.com/docs");
  });

  it("formats generic Error", () => {
    expect(() => handleCommandError(new Error("Generic problem"))).toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Generic problem");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("formats unknown error", () => {
    expect(() => handleCommandError("a string error")).toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("unexpected error");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prepends context if provided", () => {
    expect(() => handleCommandError(
      new CliError("broken"),
      undefined,
      "Failed to list companies"
    )).toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Failed to list companies");
  });

  it("stops spinner if provided", () => {
    const spinner = { fail: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock for testing
    expect(() => handleCommandError(new Error("test"), spinner as any)).toThrow("process.exit intercepted");

    expect(spinner.fail).toHaveBeenCalled();
  });

  it("handles spinner.fail throwing", () => {
    const spinner = {
      fail: vi.fn().mockImplementation(() => {
        throw new Error("spinner error");
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock for testing
    expect(() => handleCommandError(new Error("test"), spinner as any)).toThrow("process.exit intercepted");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("formats ApiError 401 with re-auth recovery hint", () => {
    expect(() =>
      handleCommandError(
        new ApiError("Unauthorized", 401, "/companies", "GET", { message: "bad token" })
      )
    ).toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Unauthorized");
    expect(written).toContain("auth login");
  });

  it("formats ApiError 404 with extracted detail message", () => {
    expect(() =>
      handleCommandError(
        new ApiError("Not Found", 404, "/companies/123", "GET", { message: "company missing" })
      )
    ).toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("company missing");
  });

  it("formats ApiError 404 without responseBody falls back to generic hint", () => {
    expect(() =>
      handleCommandError(
        new ApiError("Not Found", 404, "/companies/123", "GET")
      )
    ).toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Check the ID or name");
  });

  it("formats ZodError with parse-failure message and a doctor hint", () => {
    const schema = z.object({ id: z.string() });
    const parsed = schema.safeParse({ id: 42 });
    if (parsed.success) throw new Error("expected parse to fail");

    expect(() => handleCommandError(parsed.error)).toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("unexpected response");
    expect(written).toContain("doctor");
  });
});

describe("handleCommandError JSON envelope", () => {
  let stderrWrite: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const originalArgv = [...process.argv];

  beforeEach(() => {
    stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    process.argv = [...originalArgv, "--json"];
  });

  afterEach(() => {
    stderrWrite.mockRestore();
    exitSpy.mockRestore();
    process.argv = originalArgv;
  });

  function captured(): string {
    return stderrWrite.mock.calls.map((c) => String(c[0])).join("");
  }

  it("emits a JSON envelope with code, message, causes, recoverySteps, docsUrl for CliError", () => {
    expect(() =>
      handleCommandError(
        new CliError(
          "Auth failed",
          ["Token expired"],
          ["Run pax8 auth login", "Or check your client ID"],
          "https://docs.pax8.com/auth",
          ERROR_AUTH_EXPIRED
        )
      )
    ).toThrow("process.exit intercepted");

    const env = JSON.parse(captured());
    expect(env).toEqual({
      code: ERROR_AUTH_EXPIRED,
      message: "Auth failed",
      causes: ["Token expired"],
      recoverySteps: ["Run pax8 auth login", "Or check your client ID"],
      docsUrl: "https://docs.pax8.com/auth",
    });
  });

  it("omits unset optional fields from the JSON envelope", () => {
    expect(() =>
      handleCommandError(new CliError("simple error"))
    ).toThrow("process.exit intercepted");

    const env = JSON.parse(captured());
    expect(env).toEqual({ message: "simple error" });
    expect(env.code).toBeUndefined();
    expect(env.causes).toBeUndefined();
    expect(env.recoverySteps).toBeUndefined();
    expect(env.docsUrl).toBeUndefined();
  });

  it("prepends the context to the JSON envelope message", () => {
    expect(() =>
      handleCommandError(new CliError("nope"), undefined, "Failed to list companies")
    ).toThrow("process.exit intercepted");
    const env = JSON.parse(captured());
    expect(env.message).toBe("Failed to list companies: nope");
  });

  it("maps ApiError 401 -> ERROR_AUTH_EXPIRED", () => {
    expect(() =>
      handleCommandError(new ApiError("Unauthorized", 401, "/x", "GET"))
    ).toThrow("process.exit intercepted");
    const env = JSON.parse(captured());
    expect(env.code).toBe(ERROR_AUTH_EXPIRED);
    expect(env.recoverySteps?.[0]).toContain("auth login");
  });

  it("maps ApiError 408 -> ERROR_API_TIMEOUT", () => {
    expect(() =>
      handleCommandError(new ApiError("Timeout", 408, "/x", "GET"))
    ).toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_API_TIMEOUT);
  });

  it("maps ApiError 429 -> ERROR_RATE_LIMITED", () => {
    expect(() =>
      handleCommandError(new ApiError("Rate limited", 429, "/x", "GET"))
    ).toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_RATE_LIMITED);
  });

  it("maps ApiError 5xx -> ERROR_INTERNAL", () => {
    expect(() =>
      handleCommandError(new ApiError("Server boom", 503, "/x", "GET"))
    ).toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_INTERNAL);
  });

  it("maps ApiError 404 on /companies -> ERROR_COMPANY_NOT_FOUND", () => {
    expect(() =>
      handleCommandError(new ApiError("Not Found", 404, "/companies/abc", "GET"))
    ).toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_COMPANY_NOT_FOUND);
  });

  it("maps ApiError 404 on /products -> ERROR_PRODUCT_NOT_FOUND", () => {
    expect(() =>
      handleCommandError(new ApiError("Not Found", 404, "/products/abc", "GET"))
    ).toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_PRODUCT_NOT_FOUND);
  });

  it("maps ApiError 404 on /subscriptions -> ERROR_SUBSCRIPTION_NOT_FOUND", () => {
    expect(() =>
      handleCommandError(new ApiError("Not Found", 404, "/subscriptions/abc", "GET"))
    ).toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_SUBSCRIPTION_NOT_FOUND);
  });

  it("falls back to ERROR_NOT_AUTHORIZED on a generic 404", () => {
    expect(() =>
      handleCommandError(new ApiError("Not Found", 404, "/totallyrandom", "GET"))
    ).toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_NOT_AUTHORIZED);
  });

  it("emits ERROR_API_VALIDATION envelope for ZodError", () => {
    const schema = z.object({ id: z.string() });
    const parsed = schema.safeParse({ id: 42 });
    if (parsed.success) throw new Error("expected parse to fail");

    expect(() => handleCommandError(parsed.error)).toThrow("process.exit intercepted");

    const env = JSON.parse(captured());
    expect(env.code).toBe(ERROR_API_VALIDATION);
    expect(env.causes).toBeDefined();
    expect(env.recoverySteps).toBeDefined();
  });

  it("emits ERROR_INTERNAL for a plain Error", () => {
    expect(() => handleCommandError(new Error("oops"))).toThrow(
      "process.exit intercepted"
    );
    const env = JSON.parse(captured());
    expect(env.code).toBe(ERROR_INTERNAL);
    expect(env.message).toBe("oops");
  });

  it("emits ERROR_INTERNAL for an unknown thrown value", () => {
    expect(() => handleCommandError("nope")).toThrow("process.exit intercepted");
    const env = JSON.parse(captured());
    expect(env.code).toBe(ERROR_INTERNAL);
    expect(env.message).toContain("unexpected error");
  });

  it("includes API error responseBody detail as causes when present", () => {
    expect(() =>
      handleCommandError(
        new ApiError("Bad Request", 400, "/x", "POST", { detail: "missing field foo" })
      )
    ).toThrow("process.exit intercepted");
    const env = JSON.parse(captured());
    expect(env.causes).toEqual(["missing field foo"]);
  });
});

describe("extractErrorDetail", () => {
  it("returns undefined for non-objects", () => {
    expect(extractErrorDetail(null)).toBeUndefined();
    expect(extractErrorDetail("string")).toBeUndefined();
    expect(extractErrorDetail(42)).toBeUndefined();
  });

  it("extracts from message/error/detail/error_description in priority order", () => {
    expect(extractErrorDetail({ message: "m" })).toBe("m");
    expect(extractErrorDetail({ error: "e" })).toBe("e");
    expect(extractErrorDetail({ detail: "d" })).toBe("d");
    expect(extractErrorDetail({ error_description: "ed" })).toBe("ed");
  });

  it("extracts message from a nested error object", () => {
    expect(extractErrorDetail({ error: { message: "nested" } })).toBe("nested");
  });

  it("returns undefined when no recognized key holds a string", () => {
    expect(extractErrorDetail({ unrelated: "x" })).toBeUndefined();
    expect(extractErrorDetail({ message: 42 })).toBeUndefined();
  });
});

describe("CliError with code", () => {
  it("preserves the code property", () => {
    const err = new CliError(
      "msg",
      undefined,
      undefined,
      undefined,
      ERROR_AUTH_EXPIRED
    );
    expect(err.code).toBe(ERROR_AUTH_EXPIRED);
  });
});
