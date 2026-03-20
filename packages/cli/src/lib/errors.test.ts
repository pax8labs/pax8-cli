import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliError, handleCommandError } from "./errors.js";

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

  it("formats CliError with message", () => {
    handleCommandError(new CliError("Something broke"));

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Something broke");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("formats CliError with causes and recovery steps", () => {
    handleCommandError(
      new CliError(
        "Auth failed",
        ["Token expired"],
        ["Run pax8 auth login"]
      )
    );

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Auth failed");
    expect(written).toContain("Token expired");
    expect(written).toContain("Run pax8 auth login");
  });

  it("formats CliError with docs URL", () => {
    handleCommandError(
      new CliError("Error", undefined, undefined, "https://example.com/docs")
    );

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("https://example.com/docs");
  });

  it("formats generic Error", () => {
    handleCommandError(new Error("Generic problem"));

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Generic problem");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("formats unknown error", () => {
    handleCommandError("a string error");

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("unexpected error");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prepends context if provided", () => {
    handleCommandError(
      new CliError("broken"),
      undefined,
      "Failed to list companies"
    );

    const written = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("Failed to list companies");
  });

  it("stops spinner if provided", () => {
    const spinner = { fail: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock for testing
    handleCommandError(new Error("test"), spinner as any);

    expect(spinner.fail).toHaveBeenCalled();
  });

  it("handles spinner.fail throwing", () => {
    const spinner = {
      fail: vi.fn().mockImplementation(() => {
        throw new Error("spinner error");
      }),
    };

    // Should not throw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock for testing
    handleCommandError(new Error("test"), spinner as any);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
