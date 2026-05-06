/* eslint-disable @typescript-eslint/no-explicit-any -- accessing private members for testing */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Telemetry, getTelemetry, resetTelemetry, TELEMETRY_NOTICE, type TelemetryEvent } from "./telemetry.js";

function makeTmpDir(): string {
  return path.join(os.tmpdir(), `pax8-tel-ext-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    event: "command_executed",
    command: "test.command",
    flags: [],
    duration_ms: 100,
    success: true,
    cli_version: "0.1.0",
    node_version: process.version,
    os: process.platform,
    demo_mode: false,
    ...overrides,
  };
}

describe("Telemetry — extended coverage", () => {
  const originalEnv = { ...process.env };
  let isolatedConfigDir: string;

  beforeEach(() => {
    resetTelemetry();
    delete process.env.PAX8_TELEMETRY_DISABLED;
    delete process.env.DO_NOT_TRACK;
    // Each test gets its own config dir so enable/disable/loadEnabled don't
    // race against telemetry.test.ts (or each other) on the shared real
    // ~/.pax8/config.yaml. This was the source of the cold-cache flake: two
    // test files concurrently mutating the same config file produced ENOENT
    // and Zod parse errors inside Telemetry.disable / loadEnabled.
    isolatedConfigDir = path.join(
      os.tmpdir(),
      `pax8-tel-ext-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    process.env.PAX8_CONFIG_DIR = isolatedConfigDir;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await fs.rm(isolatedConfigDir, { recursive: true, force: true }).catch(() => {});
  });

  it("TELEMETRY_NOTICE is a non-empty string", () => {
    expect(TELEMETRY_NOTICE).toBeTruthy();
    expect(TELEMETRY_NOTICE).toContain("pax8 collects anonymous usage data");
    expect(TELEMETRY_NOTICE).toContain("DO_NOT_TRACK");
  });

  it("getTelemetry returns singleton", () => {
    const t1 = getTelemetry();
    const t2 = getTelemetry();
    expect(t1).toBe(t2);
  });

  it("resetTelemetry clears singleton", () => {
    const t1 = getTelemetry();
    resetTelemetry();
    const t2 = getTelemetry();
    expect(t1).not.toBe(t2);
  });

  it("shutdown is safe to call multiple times", async () => {
    const t = new Telemetry();
    await t.shutdown();
    await t.shutdown(); // should not throw
  });

  it("shutdown handles posthog shutdown error", async () => {
    const t = new Telemetry();
    (t as any).posthog = {
      capture: () => {},
      flush: async () => {},
      shutdown: async () => {
        throw new Error("shutdown failed");
      },
    };
    // Should not throw
    await t.shutdown();
    expect((t as any).posthog).toBeNull();
  });

  it("flush handles local write failure gracefully", async () => {
    const t = new Telemetry();
    (t as any).enabled = true;
    (t as any).storageDir = "/nonexistent/path/that/cant/exist";
    (t as any).posthog = { capture: () => {}, flush: async () => {}, shutdown: async () => {} };

    t.track(makeEvent());
    // Should not throw even though the path is invalid
    await t.flush();
    expect((t as any).buffer).toHaveLength(0);
  });

  it("flush handles PostHog send failure gracefully", async () => {
    const tmpDir = makeTmpDir();
    const t = new Telemetry();
    (t as any).enabled = true;
    (t as any).storageDir = tmpDir;
    (t as any).posthog = {
      capture: () => {
        throw new Error("capture failed");
      },
      flush: async () => {},
      shutdown: async () => {},
    };

    t.track(makeEvent());
    // Should not throw
    await t.flush();
    expect((t as any).buffer).toHaveLength(0);

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("loadEnabled reads from config when env vars not set", async () => {
    const t = new Telemetry();
    // loadEnabled will try to load the real config; if no config file,
    // it falls back to false (catch block)
    await t.loadEnabled();
    expect(t.isEnabled()).toBe(false);
  });

  describe("enable/disable", () => {
    it("enable then disable roundtrip through real config", async () => {
      const t = new Telemetry();
      expect(t.isEnabled()).toBe(false);

      // Enable writes to ~/.pax8/config.yaml
      await t.enable();
      expect(t.isEnabled()).toBe(true);

      // Disable reverts it
      await t.disable();
      expect(t.isEnabled()).toBe(false);
    });
  });

  it("loadEnabled falls back to false when config loading throws", async () => {
    // Use a corrupted config to trigger the catch branch
    const configDir = (await import("../config/loader.js")).getConfigDir();
    const configFile = (await import("node:path")).join(configDir, "config.yaml");
    const fsP = await import("node:fs/promises");

    // Save original config
    let originalContent: string | undefined;
    try {
      originalContent = await fsP.readFile(configFile, "utf-8");
    } catch {
      // no config file
    }

    try {
      // Write invalid config
      await fsP.mkdir(configDir, { recursive: true });
      await fsP.writeFile(configFile, 'version: "invalid"\ngarbage: [[[', "utf-8");

      const t2 = new Telemetry();
      await t2.loadEnabled();
      expect(t2.isEnabled()).toBe(false);
    } finally {
      // Restore original config
      if (originalContent) {
        await fsP.writeFile(configFile, originalContent, "utf-8");
      } else {
        await fsP.unlink(configFile).catch(() => {});
      }
    }
  });
});
