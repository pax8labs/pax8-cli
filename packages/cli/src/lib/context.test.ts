// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Track spawn calls so we can assert on subprocess invocations from
// `buildContext()`. After #466 there should be zero — the detached
// `spawnCacheWarmer` is gone and on-disk cache populates organically
// from real user reads.
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

import { getOutputFormat, buildContext } from "./context.js";

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

  // PAX8_DEMO=false / =0 must force demo OFF even when config has demo:true,
  // so users can keep `demo: true` in `~/.pax8/config.yaml` as a safety default
  // and opt out per-invocation.
  for (const falsyValue of ["false", "0"]) {
    it(`PAX8_DEMO='${falsyValue}' overrides config 'demo: true'`, async () => {
      process.env.PAX8_DEMO = falsyValue;

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
      const getCredSpy = vi
        .spyOn(core.CredentialStore.prototype, "getCredentials")
        .mockResolvedValue({ clientId: "id-x", clientSecret: "secret-y" });
      try {
        const ctx = await buildContext({ json: true });
        expect(ctx.isDemo).toBe(false);
      } finally {
        loadSpy.mockRestore();
        getCredSpy.mockRestore();
      }
    });
  }

  for (const truthyValue of ["1", "true"]) {
    it(`PAX8_DEMO='${truthyValue}' enables demo mode even without config`, async () => {
      process.env.PAX8_DEMO = truthyValue;
      const ctx = await buildContext({ json: true });
      expect(ctx.isDemo).toBe(true);
    });
  }

  it("non-demo path constructs a real api client when credentials are present", async () => {
    delete process.env.PAX8_DEMO;

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
    }
  });

  // Regression guard for #466: the detached `spawnCacheWarmer` has been removed.
  // `buildContext()` must NOT spawn any subprocesses — neither in demo mode nor
  // on the real-API path. The on-disk cache populates organically from user
  // reads instead.
  it("non-demo buildContext does not spawn any subprocesses (#466)", async () => {
    delete process.env.PAX8_DEMO;
    spawnCalls.length = 0;

    const core = await import("@pax8/core");
    const getCredSpy = vi
      .spyOn(core.CredentialStore.prototype, "getCredentials")
      .mockResolvedValue({ clientId: "id-x", clientSecret: "secret-y" });

    try {
      await buildContext({ json: true });
      expect(spawnCalls).toEqual([]);
    } finally {
      getCredSpy.mockRestore();
    }
  });

  it("demo buildContext does not spawn any subprocesses (#466)", async () => {
    process.env.PAX8_DEMO = "1";
    spawnCalls.length = 0;
    await buildContext({ json: true });
    expect(spawnCalls).toEqual([]);
  });

  // #253: the schema documents `cache.enabled` and `cache.ttl_hours`. Before
  // this change those values were silently ignored — `Pax8Client` got its
  // 1h hardcoded default regardless of config. These tests pin that the
  // values now flow through to the constructor.
  describe("cache config plumbing (#253)", () => {
    it("passes cacheTtlMs derived from config.cache.ttl_hours when enabled", async () => {
      delete process.env.PAX8_DEMO;
      const core = await import("@pax8/core");
      const loadSpy = vi.spyOn(core, "loadConfig").mockResolvedValue({
        version: "1.0",
        defaults: { output_format: "table", page_size: 50, confirm_destructive: true },
        cache: { enabled: true, ttl_hours: 6 },
        telemetry: { enabled: false },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial config for tests
      } as any);
      const getCredSpy = vi
        .spyOn(core.CredentialStore.prototype, "getCredentials")
        .mockResolvedValue({ clientId: "id-x", clientSecret: "secret-y" });
      const ctorSpy = vi.spyOn(core, "Pax8Client");

      try {
        await buildContext({ json: true });
        expect(ctorSpy).toHaveBeenCalledTimes(1);
        const opts = ctorSpy.mock.calls[0][0];
        expect(opts.cacheTtlMs).toBe(6 * 3_600_000);
      } finally {
        loadSpy.mockRestore();
        getCredSpy.mockRestore();
        ctorSpy.mockRestore();
      }
    });

    it("PAX8_NO_CACHE=1 overrides config.cache.enabled and passes cacheTtlMs=0", async () => {
      delete process.env.PAX8_DEMO;
      process.env.PAX8_NO_CACHE = "1";
      const core = await import("@pax8/core");
      const loadSpy = vi.spyOn(core, "loadConfig").mockResolvedValue({
        version: "1.0",
        defaults: { output_format: "table", page_size: 50, confirm_destructive: true },
        cache: { enabled: true, ttl_hours: 6 },
        telemetry: { enabled: false },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial config for tests
      } as any);
      const getCredSpy = vi
        .spyOn(core.CredentialStore.prototype, "getCredentials")
        .mockResolvedValue({ clientId: "id-x", clientSecret: "secret-y" });
      const ctorSpy = vi.spyOn(core, "Pax8Client");

      try {
        await buildContext({ json: true });
        expect(ctorSpy).toHaveBeenCalledTimes(1);
        const opts = ctorSpy.mock.calls[0][0];
        expect(opts.cacheTtlMs).toBe(0);
      } finally {
        delete process.env.PAX8_NO_CACHE;
        loadSpy.mockRestore();
        getCredSpy.mockRestore();
        ctorSpy.mockRestore();
      }
    });

    it("passes cacheTtlMs=0 when config.cache.enabled is false", async () => {
      delete process.env.PAX8_DEMO;
      const core = await import("@pax8/core");
      const loadSpy = vi.spyOn(core, "loadConfig").mockResolvedValue({
        version: "1.0",
        defaults: { output_format: "table", page_size: 50, confirm_destructive: true },
        cache: { enabled: false, ttl_hours: 24 },
        telemetry: { enabled: false },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial config for tests
      } as any);
      const getCredSpy = vi
        .spyOn(core.CredentialStore.prototype, "getCredentials")
        .mockResolvedValue({ clientId: "id-x", clientSecret: "secret-y" });
      const ctorSpy = vi.spyOn(core, "Pax8Client");

      try {
        await buildContext({ json: true });
        expect(ctorSpy).toHaveBeenCalledTimes(1);
        const opts = ctorSpy.mock.calls[0][0];
        expect(opts.cacheTtlMs).toBe(0);
      } finally {
        loadSpy.mockRestore();
        getCredSpy.mockRestore();
        ctorSpy.mockRestore();
      }
    });
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
