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
  it("constructs with message only", async () => {
    const err = new CliError("Something went wrong");
    expect(err.message).toBe("Something went wrong");
    expect(err.name).toBe("CliError");
    expect(err.causes).toBeUndefined();
    expect(err.recoverySteps).toBeUndefined();
    expect(err.docsUrl).toBeUndefined();
  });

  it("constructs with all options", async () => {
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

  it("is an instance of Error", async () => {
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

  it("formats CliError with message", async () => {
    await expect(handleCommandError(new CliError("Something broke"))).rejects.toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Something broke");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("formats CliError with causes and recovery steps", async () => {
    await expect(handleCommandError(
      new CliError(
        "Auth failed",
        ["Token expired"],
        ["Run pax8 auth login"]
      )
    )).rejects.toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Auth failed");
    expect(written).toContain("Token expired");
    expect(written).toContain("Run pax8 auth login");
  });

  it("formats CliError with docs URL", async () => {
    await expect(handleCommandError(
      new CliError("Error", undefined, undefined, "https://example.com/docs")
    )).rejects.toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("https://example.com/docs");
  });

  it("formats generic Error", async () => {
    await expect(handleCommandError(new Error("Generic problem"))).rejects.toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Generic problem");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("formats unknown error", async () => {
    await expect(handleCommandError("a string error")).rejects.toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("unexpected error");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prepends context if provided", async () => {
    await expect(handleCommandError(
      new CliError("broken"),
      undefined,
      "Failed to list companies"
    )).rejects.toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Failed to list companies");
  });

  it("stops spinner if provided", async () => {
    const spinner = { fail: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock for testing
    await expect(handleCommandError(new Error("test"), spinner as any)).rejects.toThrow("process.exit intercepted");

    expect(spinner.fail).toHaveBeenCalled();
  });

  it("handles spinner.fail throwing", async () => {
    const spinner = {
      fail: vi.fn().mockImplementation(() => {
        throw new Error("spinner error");
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock for testing
    await expect(handleCommandError(new Error("test"), spinner as any)).rejects.toThrow("process.exit intercepted");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("formats ApiError 401 with re-auth recovery hint", async () => {
    await expect(
      handleCommandError(
        new ApiError("Unauthorized", 401, "/companies", "GET", { message: "bad token" })
      )
    ).rejects.toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Unauthorized");
    expect(written).toContain("auth login");
  });

  it("formats ApiError 404 with extracted detail message", async () => {
    await expect(
      handleCommandError(
        new ApiError("Not Found", 404, "/companies/123", "GET", { message: "company missing" })
      )
    ).rejects.toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("company missing");
  });

  it("formats ApiError 404 without responseBody falls back to generic hint", async () => {
    await expect(
      handleCommandError(
        new ApiError("Not Found", 404, "/companies/123", "GET")
      )
    ).rejects.toThrow("process.exit intercepted");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Check the ID or name");
  });

  it("formats ZodError with parse-failure message and a doctor hint", async () => {
    const schema = z.object({ id: z.string() });
    const parsed = schema.safeParse({ id: 42 });
    if (parsed.success) throw new Error("expected parse to fail");

    await expect(handleCommandError(parsed.error)).rejects.toThrow("process.exit intercepted");

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

  it("emits a JSON envelope with code, message, causes, recoverySteps, docsUrl for CliError", async () => {
    await expect(
      handleCommandError(
        new CliError(
          "Auth failed",
          ["Token expired"],
          ["Run pax8 auth login", "Or check your client ID"],
          "https://docs.pax8.com/auth",
          ERROR_AUTH_EXPIRED
        )
      )
    ).rejects.toThrow("process.exit intercepted");

    const env = JSON.parse(captured());
    expect(env).toEqual({
      code: ERROR_AUTH_EXPIRED,
      message: "Auth failed",
      causes: ["Token expired"],
      recoverySteps: ["Run pax8 auth login", "Or check your client ID"],
      docsUrl: "https://docs.pax8.com/auth",
    });
  });

  it("omits unset optional fields from the JSON envelope", async () => {
    await expect(
      handleCommandError(new CliError("simple error"))
    ).rejects.toThrow("process.exit intercepted");

    const env = JSON.parse(captured());
    expect(env).toEqual({ message: "simple error" });
    expect(env.code).toBeUndefined();
    expect(env.causes).toBeUndefined();
    expect(env.recoverySteps).toBeUndefined();
    expect(env.docsUrl).toBeUndefined();
  });

  it("prepends the context to the JSON envelope message", async () => {
    await expect(
      handleCommandError(new CliError("nope"), undefined, "Failed to list companies")
    ).rejects.toThrow("process.exit intercepted");
    const env = JSON.parse(captured());
    expect(env.message).toBe("Failed to list companies: nope");
  });

  it("maps ApiError 401 -> ERROR_AUTH_EXPIRED", async () => {
    await expect(
      handleCommandError(new ApiError("Unauthorized", 401, "/x", "GET"))
    ).rejects.toThrow("process.exit intercepted");
    const env = JSON.parse(captured());
    expect(env.code).toBe(ERROR_AUTH_EXPIRED);
    expect(env.recoverySteps?.[0]).toContain("auth login");
  });

  it("maps ApiError 408 -> ERROR_API_TIMEOUT", async () => {
    await expect(
      handleCommandError(new ApiError("Timeout", 408, "/x", "GET"))
    ).rejects.toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_API_TIMEOUT);
  });

  it("maps ApiError 429 -> ERROR_RATE_LIMITED", async () => {
    await expect(
      handleCommandError(new ApiError("Rate limited", 429, "/x", "GET"))
    ).rejects.toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_RATE_LIMITED);
  });

  it("maps ApiError 5xx -> ERROR_INTERNAL", async () => {
    await expect(
      handleCommandError(new ApiError("Server boom", 503, "/x", "GET"))
    ).rejects.toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_INTERNAL);
  });

  it("maps ApiError 404 on /companies -> ERROR_COMPANY_NOT_FOUND", async () => {
    await expect(
      handleCommandError(new ApiError("Not Found", 404, "/companies/abc", "GET"))
    ).rejects.toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_COMPANY_NOT_FOUND);
  });

  it("maps ApiError 404 on /products -> ERROR_PRODUCT_NOT_FOUND", async () => {
    await expect(
      handleCommandError(new ApiError("Not Found", 404, "/products/abc", "GET"))
    ).rejects.toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_PRODUCT_NOT_FOUND);
  });

  it("maps ApiError 404 on /subscriptions -> ERROR_SUBSCRIPTION_NOT_FOUND", async () => {
    await expect(
      handleCommandError(new ApiError("Not Found", 404, "/subscriptions/abc", "GET"))
    ).rejects.toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_SUBSCRIPTION_NOT_FOUND);
  });

  it("falls back to ERROR_NOT_AUTHORIZED on a generic 404", async () => {
    await expect(
      handleCommandError(new ApiError("Not Found", 404, "/totallyrandom", "GET"))
    ).rejects.toThrow("process.exit intercepted");
    expect(JSON.parse(captured()).code).toBe(ERROR_NOT_AUTHORIZED);
  });

  it("emits ERROR_API_VALIDATION envelope for ZodError", async () => {
    const schema = z.object({ id: z.string() });
    const parsed = schema.safeParse({ id: 42 });
    if (parsed.success) throw new Error("expected parse to fail");

    await expect(handleCommandError(parsed.error)).rejects.toThrow("process.exit intercepted");

    const env = JSON.parse(captured());
    expect(env.code).toBe(ERROR_API_VALIDATION);
    expect(env.causes).toBeDefined();
    expect(env.recoverySteps).toBeDefined();
  });

  it("emits ERROR_INTERNAL for a plain Error", async () => {
    await expect(handleCommandError(new Error("oops"))).rejects.toThrow(
      "process.exit intercepted"
    );
    const env = JSON.parse(captured());
    expect(env.code).toBe(ERROR_INTERNAL);
    expect(env.message).toBe("oops");
  });

  it("emits ERROR_INTERNAL for an unknown thrown value", async () => {
    await expect(handleCommandError("nope")).rejects.toThrow("process.exit intercepted");
    const env = JSON.parse(captured());
    expect(env.code).toBe(ERROR_INTERNAL);
    expect(env.message).toContain("unexpected error");
  });

  it("includes API error responseBody detail as causes when present", async () => {
    await expect(
      handleCommandError(
        new ApiError("Bad Request", 400, "/x", "POST", { detail: "missing field foo" })
      )
    ).rejects.toThrow("process.exit intercepted");
    const env = JSON.parse(captured());
    expect(env.causes).toEqual(["missing field foo"]);
  });
});

describe("extractErrorDetail", () => {
  it("returns undefined for non-objects", async () => {
    expect(extractErrorDetail(null)).toBeUndefined();
    expect(extractErrorDetail("string")).toBeUndefined();
    expect(extractErrorDetail(42)).toBeUndefined();
  });

  it("extracts from message/error/detail/error_description in priority order", async () => {
    expect(extractErrorDetail({ message: "m" })).toBe("m");
    expect(extractErrorDetail({ error: "e" })).toBe("e");
    expect(extractErrorDetail({ detail: "d" })).toBe("d");
    expect(extractErrorDetail({ error_description: "ed" })).toBe("ed");
  });

  it("extracts message from a nested error object", async () => {
    expect(extractErrorDetail({ error: { message: "nested" } })).toBe("nested");
  });

  it("returns undefined when no recognized key holds a string", async () => {
    expect(extractErrorDetail({ unrelated: "x" })).toBeUndefined();
    expect(extractErrorDetail({ message: 42 })).toBeUndefined();
  });
});

describe("CliError with code", () => {
  it("preserves the code property", async () => {
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

describe("handleCommandError flushes telemetry before exit (#145)", () => {
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

  it("awaits Telemetry.flushAndShutdown() before process.exit", async () => {
    const { getTelemetry } = await import("@pax8/core");
    const tel = getTelemetry();

    // Order-of-operations spy: flushAndShutdown must complete before exit.
    const callOrder: string[] = [];
    let resolveFlush: () => void = () => {};
    const flushSpy = vi
      .spyOn(tel, "flushAndShutdown")
      .mockImplementation(() => {
        callOrder.push("flushAndShutdown:start");
        return new Promise<void>((resolve) => {
          resolveFlush = () => {
            callOrder.push("flushAndShutdown:end");
            resolve();
          };
        });
      });

    // Start the call but don't await it yet — we need to verify exit hasn't
    // been triggered while flush is still pending.
    const promise = handleCommandError(new CliError("boom")).catch(() => {
      callOrder.push("exit-throw");
    });

    // Yield to let the async function run up to the await on flush.
    await new Promise((r) => setImmediate(r));
    expect(callOrder).toEqual(["flushAndShutdown:start"]);
    expect(exitSpy).not.toHaveBeenCalled();

    // Now release the flush. exit must follow.
    resolveFlush();
    await promise;

    expect(callOrder).toContain("flushAndShutdown:end");
    expect(callOrder.indexOf("flushAndShutdown:end"))
      .toBeLessThan(callOrder.indexOf("exit-throw"));
    expect(exitSpy).toHaveBeenCalledWith(1);

    flushSpy.mockRestore();
  });

  it("still exits with 1 even if flushAndShutdown throws", async () => {
    const { getTelemetry } = await import("@pax8/core");
    const tel = getTelemetry();
    const flushSpy = vi
      .spyOn(tel, "flushAndShutdown")
      .mockRejectedValue(new Error("posthog network down"));

    await expect(handleCommandError(new CliError("boom"))).rejects.toThrow(
      "process.exit intercepted",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    flushSpy.mockRestore();
  });
});
