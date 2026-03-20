import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getOutputFormat, buildContext, type GlobalOptions } from "./context.js";

describe("getOutputFormat", () => {
  const originalIsTTY = process.stdout.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, writable: true });
  });

  it("returns 'quiet' when quiet option is set", () => {
    expect(getOutputFormat({ quiet: true })).toBe("quiet");
  });

  it("returns 'json' when json option is set", () => {
    expect(getOutputFormat({ json: true })).toBe("json");
  });

  it("returns 'csv' when csv option is set", () => {
    expect(getOutputFormat({ csv: true })).toBe("csv");
  });

  it("returns 'json' when stdout is not a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true });
    expect(getOutputFormat({})).toBe("json");
  });

  it("returns 'table' when stdout is a TTY and no format specified", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
    expect(getOutputFormat({})).toBe("table");
  });

  it("quiet takes precedence over json", () => {
    expect(getOutputFormat({ quiet: true, json: true })).toBe("quiet");
  });

  it("json takes precedence over csv", () => {
    expect(getOutputFormat({ json: true, csv: true })).toBe("json");
  });

  it("uses config default in TTY when no explicit flag", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
    expect(getOutputFormat({}, "json")).toBe("json");
  });

  it("config default is ignored when non-TTY (pipe always returns json)", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true });
    expect(getOutputFormat({}, "table")).toBe("json");
  });

  it("explicit --csv flag overrides config default", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
    expect(getOutputFormat({ csv: true }, "json")).toBe("csv");
  });
});

describe("buildContext", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.PAX8_DEMO;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns demo context when PAX8_DEMO=1", async () => {
    process.env.PAX8_DEMO = "1";
    const ctx = await buildContext({ json: true });

    expect(ctx.isDemo).toBe(true);
    expect(ctx.outputFormat).toBe("json");
    expect(ctx.api).toBeDefined();
    expect(ctx.api.companies).toBeDefined();
  });

  it("throws CliError when not in demo mode and no credentials", async () => {
    process.env.PAX8_DEMO = undefined;
    delete process.env.PAX8_CLIENT_ID;
    delete process.env.PAX8_CLIENT_SECRET;

    // Mock CredentialStore so keychain credentials don't interfere
    const core = await import("@pax8/core");
    const getCredSpy = vi.spyOn(core.CredentialStore.prototype, "getCredentials")
      .mockResolvedValue(null);

    try {
      await expect(buildContext({ json: true })).rejects.toThrow("Not authenticated");
    } finally {
      getCredSpy.mockRestore();
    }
  });
});
