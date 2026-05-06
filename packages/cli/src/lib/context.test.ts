// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Track spawn calls so we can assert on cache-warmer invocations without
// actually spawning detached child processes during tests.
const spawnCalls: Array<{ cmd: string; args: string[] }> = [];

vi.mock("node:child_process", async (importActual) => {
  const actual = await importActual<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (cmd: string, args: string[], _opts?: unknown) => {
      spawnCalls.push({ cmd, args });
      const obj = {
        on: () => obj,
        unref: () => {},
      };
      return obj;
    },
  };
});

import { getOutputFormat, buildContext, warnIfTruncated } from "./context.js";

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

describe("warnIfTruncated", () => {
  it("writes warning to stderr when result hits the page size limit", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    warnIfTruncated({ content: new Array(1000) }, 1000);
    expect(writeSpy).toHaveBeenCalledOnce();
    expect(writeSpy.mock.calls[0][0]).toContain("1000 subscriptions (page limit)");
    expect(writeSpy.mock.calls[0][0]).toContain("results may be incomplete");
    writeSpy.mockRestore();
  });

  it("does not warn when result count is below the page size", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    warnIfTruncated({ content: new Array(500) }, 1000);
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
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

  it("returns the ERROR_AUTH_MISSING code on the missing-credentials CliError", async () => {
    process.env.PAX8_DEMO = undefined;
    delete process.env.PAX8_CLIENT_ID;
    delete process.env.PAX8_CLIENT_SECRET;

    const core = await import("@pax8/core");
    const getCredSpy = vi
      .spyOn(core.CredentialStore.prototype, "getCredentials")
      .mockResolvedValue(null);

    try {
      const error = await buildContext({ json: true }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      const err = error as Error & {
        code?: string;
        causes?: string[];
        recoverySteps?: string[];
        docsUrl?: string;
      };
      expect(err.code).toBe(core.ERROR_AUTH_MISSING);
      expect(err.causes).toEqual(["No Pax8 API credentials found"]);
      expect(err.recoverySteps?.length).toBeGreaterThan(0);
      expect(err.docsUrl).toBe("https://devx.pax8.com/");
    } finally {
      getCredSpy.mockRestore();
    }
  });

  it("propagates verbose=true through to the demo-mode context", async () => {
    process.env.PAX8_DEMO = "1";
    const ctx = await buildContext({ verbose: true, json: true });
    expect(ctx.verbose).toBe(true);
  });

  it("defaults verbose to false when not provided", async () => {
    process.env.PAX8_DEMO = "1";
    const ctx = await buildContext({ json: true });
    expect(ctx.verbose).toBe(false);
  });

  it("config 'demo: true' enables demo mode even without PAX8_DEMO env", async () => {
    delete process.env.PAX8_DEMO;
    const core = await import("@pax8/core");
    const cfg = {
      version: "1.0" as const,
      demo: true,
      defaults: {
        output_format: "table" as const,
        page_size: 50,
        confirm_destructive: true,
      },
      cache: { enabled: true, ttl_hours: 24 },
      telemetry: { enabled: false },
    };
    const loadSpy = vi
      .spyOn(core, "loadConfig")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial config for tests
      .mockResolvedValue(cfg as any);
    try {
      const ctx = await buildContext({ json: true });
      expect(ctx.isDemo).toBe(true);
    } finally {
      loadSpy.mockRestore();
    }
  });

  it("non-demo path constructs a real api client when credentials are present", async () => {
    delete process.env.PAX8_DEMO;
    // Skip the cache warmer so the test doesn't spawn detached child procs.
    process.env.PAX8_CACHE_WARMING = "1";

    const core = await import("@pax8/core");
    const getCredSpy = vi
      .spyOn(core.CredentialStore.prototype, "getCredentials")
      .mockResolvedValue({ clientId: "id-x", clientSecret: "secret-y" });

    try {
      const ctx = await buildContext({ json: true, verbose: true });
      expect(ctx.isDemo).toBe(false);
      expect(ctx.verbose).toBe(true);
      expect(ctx.outputFormat).toBe("json");
      // Should expose the full ApiClient surface
      expect(ctx.api).toBeDefined();
      expect("companies" in ctx.api).toBe(true);
      expect("subscriptions" in ctx.api).toBe(true);
      expect("orders" in ctx.api).toBe(true);
      expect("invoices" in ctx.api).toBe(true);
      expect("contacts" in ctx.api).toBe(true);
      expect("products" in ctx.api).toBe(true);
      expect("usage" in ctx.api).toBe(true);
      expect("quotes" in ctx.api).toBe(true);
      expect("webhooks" in ctx.api).toBe(true);
    } finally {
      getCredSpy.mockRestore();
      delete process.env.PAX8_CACHE_WARMING;
    }
  });

  it("non-demo path spawns three cache warmers when not already warming", async () => {
    delete process.env.PAX8_DEMO;
    delete process.env.PAX8_CACHE_WARMING;
    spawnCalls.length = 0;

    const core = await import("@pax8/core");
    const getCredSpy = vi
      .spyOn(core.CredentialStore.prototype, "getCredentials")
      .mockResolvedValue({ clientId: "id-x", clientSecret: "secret-y" });

    try {
      await buildContext({ json: true });
      expect(spawnCalls).toHaveLength(3);
      // The warmers list companies, subscriptions, products in parallel.
      const resources = spawnCalls.map((c) => c.args[0]).sort();
      expect(resources).toEqual(["companies", "products", "subscriptions"]);
      // Each should pass --quiet --json so they never write to a real terminal.
      for (const c of spawnCalls) {
        expect(c.args).toContain("--json");
        expect(c.args).toContain("--quiet");
      }
    } finally {
      getCredSpy.mockRestore();
    }
  });

  it("loadConfig failure is recovered with sane defaults", async () => {
    process.env.PAX8_DEMO = "1";
    const core = await import("@pax8/core");
    const loadSpy = vi
      .spyOn(core, "loadConfig")
      .mockRejectedValue(new Error("config corrupt"));
    try {
      const ctx = await buildContext({});
      expect(ctx.config.version).toBe("1.0");
      expect(ctx.config.defaults?.page_size).toBe(50);
      expect(ctx.isDemo).toBe(true);
    } finally {
      loadSpy.mockRestore();
    }
  });
});
