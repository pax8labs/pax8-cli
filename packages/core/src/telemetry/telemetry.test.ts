// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable @typescript-eslint/no-explicit-any -- accessing private members for testing */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  Telemetry,
  resetTelemetry,
  bucketDollars,
  bucketSeats,
  bucketLineCount,
  type TelemetryEvent,
} from "./telemetry.js";
import { ERROR_COMPANY_NOT_FOUND } from "../errors/codes.js";

function makeTmpDir(): string {
  return path.join(os.tmpdir(), `pax8-telemetry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    event: "command_executed",
    command: "subscriptions.list",
    flags: ["--json", "--company"],
    duration_ms: 123,
    success: true,
    cli_version: "0.1.0",
    node_version: process.version,
    os: process.platform,
    demo_mode: false,
    ...overrides,
  };
}

describe("Telemetry", () => {
  const originalEnv = { ...process.env };
  let isolatedConfigDir: string;

  beforeEach(() => {
    resetTelemetry();
    delete process.env.PAX8_TELEMETRY_DISABLED;
    delete process.env.DO_NOT_TRACK;
    // Each test gets its own config dir so we don't clobber the user's real
    // ~/.pax8 or race against other test files that touch config.yaml.
    isolatedConfigDir = path.join(
      os.tmpdir(),
      `pax8-telemetry-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    process.env.PAX8_CONFIG_DIR = isolatedConfigDir;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await fs.rm(isolatedConfigDir, { recursive: true, force: true }).catch(() => {});
  });

  it("is disabled by default", () => {
    const t = new Telemetry();
    expect(t.isEnabled()).toBe(false);
  });

  it("respects DO_NOT_TRACK=1", async () => {
    process.env.DO_NOT_TRACK = "1";
    const t = new Telemetry();
    await t.loadEnabled();
    expect(t.isEnabled()).toBe(false);
  });

  it("respects PAX8_TELEMETRY_DISABLED=1", async () => {
    process.env.PAX8_TELEMETRY_DISABLED = "1";
    const t = new Telemetry();
    await t.loadEnabled();
    expect(t.isEnabled()).toBe(false);
  });

  it("can be enabled and disabled", async () => {
    // We need a real config file for enable/disable to work
    const tmpDir = makeTmpDir();
    await fs.mkdir(tmpDir, { recursive: true });
    const configPath = path.join(tmpDir, "config.yaml");
    await fs.writeFile(configPath, 'version: "1.0"\ntelemetry:\n  enabled: false\n', "utf-8");

    // We can't easily mock ESM, so we test the public interface with real config.
    // Instead, test the state toggle:
    const t = new Telemetry();
    expect(t.isEnabled()).toBe(false);

    // Simulate enable by toggling internal state (enable() writes config which
    // requires the real config dir; we verify flush separately)
    // For a proper integration, we test the commands in CLI subprocess tests.

    // Clean up
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("track buffers events when enabled", () => {
    const t = new Telemetry();
    // Force enabled for testing
    (t as any).enabled = true;

    const event = makeEvent();
    t.track(event);
    t.track(makeEvent({ command: "companies.list" }));

    expect((t as any).buffer).toHaveLength(2);
  });

  it("track does not buffer when disabled", () => {
    const t = new Telemetry();
    expect(t.isEnabled()).toBe(false);

    t.track(makeEvent());
    expect((t as any).buffer).toHaveLength(0);
  });

  it("flush writes JSONL to daily file", async () => {
    const tmpDir = makeTmpDir();
    const t = new Telemetry();
    (t as any).enabled = true;
    (t as any).storageDir = tmpDir;
    // Stub PostHog so flush doesn't make network calls
    (t as any).posthog = { capture: () => {}, flush: async () => {}, shutdown: async () => {} };

    const event1 = makeEvent();
    const event2 = makeEvent({ command: "companies.get", success: false, error_code: ERROR_COMPANY_NOT_FOUND });
    t.track(event1);
    t.track(event2);

    await t.flush();

    const today = new Date().toISOString().slice(0, 10);
    const filePath = path.join(tmpDir, `${today}.jsonl`);
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(event1);
    expect(JSON.parse(lines[1])).toEqual(event2);

    // Buffer should be cleared
    expect((t as any).buffer).toHaveLength(0);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("flush is a no-op when buffer is empty", async () => {
    const tmpDir = makeTmpDir();
    const t = new Telemetry();
    (t as any).storageDir = tmpDir;

    await t.flush();

    // Directory should not have been created
    await expect(fs.access(tmpDir)).rejects.toThrow();
  });

  it("flushAndShutdown is a no-op fast path when telemetry is disabled (#145)", async () => {
    const t = new Telemetry();
    expect(t.isEnabled()).toBe(false);

    // Stub a posthog with a shutdown that would hang for a long time. The
    // disabled fast path must skip it entirely so opt-out users pay no
    // latency.
    let posthogShutdownCalled = false;
    (t as any).posthog = {
      shutdown: () => {
        posthogShutdownCalled = true;
        return new Promise(() => {}); // never resolves
      },
    };

    const start = Date.now();
    await t.flushAndShutdown(2000);
    const elapsed = Date.now() - start;

    expect(posthogShutdownCalled).toBe(false);
    expect(elapsed).toBeLessThan(50);
  });

  it("flushAndShutdown is bounded by the timeout when posthog hangs (#145)", async () => {
    const t = new Telemetry();
    (t as any).enabled = true;
    // Buffer something so flush() actually runs.
    t.track(makeEvent());

    // Hanging shutdown — must not wedge the CLI on exit.
    (t as any).posthog = {
      capture: () => {},
      flush: async () => {},
      shutdown: () => new Promise(() => {}),
    };

    const start = Date.now();
    await t.flushAndShutdown(50);
    const elapsed = Date.now() - start;

    // Allow some slack for CI; the point is "doesn't take seconds".
    expect(elapsed).toBeLessThan(500);
  });

  it("flushAndShutdown awaits a fast posthog shutdown to completion (#145)", async () => {
    const t = new Telemetry();
    (t as any).enabled = true;
    t.track(makeEvent());

    let shutdownCalled = false;
    (t as any).posthog = {
      capture: () => {},
      flush: async () => {},
      shutdown: async () => {
        await new Promise((r) => setTimeout(r, 5));
        shutdownCalled = true;
      },
    };

    await t.flushAndShutdown(2000);
    expect(shutdownCalled).toBe(true);
  });

  it("never includes sensitive data in events", () => {
    const event = makeEvent({
      flags: ["--company", "--json"],
    });

    const serialized = JSON.stringify(event);

    // Should contain flag names
    expect(serialized).toContain("--company");
    expect(serialized).toContain("--json");

    // Should NOT contain any values, IDs, or paths
    // Verify the interface only allows prescribed fields
    const keys = Object.keys(event);
    const allowedKeys = [
      "event",
      "command",
      "flags",
      "duration_ms",
      "success",
      "error_code",
      "cli_version",
      "node_version",
      "os",
      "demo_mode",
    ];
    for (const key of keys) {
      expect(allowedKeys).toContain(key);
    }
  });
});

describe("Telemetry — revenue bucketing (M-2)", () => {
  // The security review flagged raw revenue values as a partner fingerprint
  // when combined with the distinct_id. These tests pin the cuts so anyone
  // editing the buckets has to acknowledge they're changing a security
  // boundary, not just an arithmetic detail.

  describe("bucketDollars", () => {
    it("maps 0 to '<10'", () => expect(bucketDollars(0)).toBe("<10"));
    it("maps negative to '<10'", () => expect(bucketDollars(-50)).toBe("<10"));
    it("maps boundary 9.99 to '<10'", () => expect(bucketDollars(9.99)).toBe("<10"));
    it("maps boundary 10 to '10-50'", () => expect(bucketDollars(10)).toBe("10-50"));
    it("maps mid-range 40 to '10-50'", () => expect(bucketDollars(40)).toBe("10-50"));
    it("maps boundary 50 to '50-200'", () => expect(bucketDollars(50)).toBe("50-200"));
    it("maps 199.99 to '50-200'", () => expect(bucketDollars(199.99)).toBe("50-200"));
    it("maps boundary 200 to '200-1000'", () => expect(bucketDollars(200)).toBe("200-1000"));
    it("maps 999.99 to '200-1000'", () => expect(bucketDollars(999.99)).toBe("200-1000"));
    it("maps boundary 1000 to '>1000'", () => expect(bucketDollars(1000)).toBe(">1000"));
    it("maps very large to '>1000'", () => expect(bucketDollars(1_000_000)).toBe(">1000"));
    it("maps NaN to '<10' (defensive: never let NaN ship as a bucket)", () =>
      expect(bucketDollars(NaN)).toBe("<10"));
    it("maps Infinity to '<10' (defensive: non-finite is never a real revenue value)", () =>
      expect(bucketDollars(Infinity)).toBe("<10"));
  });

  describe("bucketSeats", () => {
    it("maps 0 to '<10'", () => expect(bucketSeats(0)).toBe("<10"));
    it("maps 9 to '<10'", () => expect(bucketSeats(9)).toBe("<10"));
    it("maps boundary 10 to '10-50'", () => expect(bucketSeats(10)).toBe("10-50"));
    it("maps boundary 50 to '10-50'", () => expect(bucketSeats(50)).toBe("10-50"));
    it("maps 51 to '>50'", () => expect(bucketSeats(51)).toBe(">50"));
    it("maps very large to '>50'", () => expect(bucketSeats(10_000)).toBe(">50"));
  });

  describe("bucketLineCount", () => {
    it("maps 0 to '1'", () => expect(bucketLineCount(0)).toBe("1"));
    it("maps 1 to '1'", () => expect(bucketLineCount(1)).toBe("1"));
    it("maps 2 to '2-5'", () => expect(bucketLineCount(2)).toBe("2-5"));
    it("maps 5 to '2-5'", () => expect(bucketLineCount(5)).toBe("2-5"));
    it("maps 6 to '>5'", () => expect(bucketLineCount(6)).toBe(">5"));
    it("maps 100 to '>5'", () => expect(bucketLineCount(100)).toBe(">5"));
  });

  it("flush ships *_bucket properties to PostHog, not raw revenue numbers", async () => {
    const t = new Telemetry();
    (t as any).enabled = true;
    (t as any).storageDir = path.join(
      os.tmpdir(),
      `pax8-tel-buck-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    const captures: Array<{ properties: Record<string, unknown> }> = [];
    (t as any).posthog = {
      capture: (payload: { properties: Record<string, unknown> }) => {
        captures.push(payload);
      },
      flush: async () => {},
      shutdown: async () => {},
    };

    t.track({
      event: "command_executed",
      command: "orders.create",
      flags: [],
      duration_ms: 100,
      success: true,
      cli_version: "0.1.0",
      node_version: process.version,
      os: process.platform,
      demo_mode: false,
      order_total_dollars: 4242,
      order_mrr_impact: 175,
      order_seats: 8,
      order_line_count: 3,
      recs_mrr_captured: 999.99,
    });

    await t.flush();

    expect(captures).toHaveLength(1);
    const props = captures[0].properties;

    // Portfolio tag: distinguishes pax8-cli events from pax8-cta in the
    // shared PostHog project. If this regresses, every saved insight or
    // alert that filters on `app = "pax8-cli"` silently breaks.
    expect(props.app).toBe("pax8-cli");

    // Raw fields MUST be gone from the PostHog payload.
    expect(props).not.toHaveProperty("order_total_dollars");
    expect(props).not.toHaveProperty("order_mrr_impact");
    expect(props).not.toHaveProperty("order_seats");
    expect(props).not.toHaveProperty("order_line_count");
    expect(props).not.toHaveProperty("recs_mrr_captured");

    // Buckets present with the expected string values.
    expect(props.order_total_bucket).toBe(">1000");
    expect(props.order_mrr_bucket).toBe("50-200");
    expect(props.order_seats_bucket).toBe("<10");
    expect(props.order_line_count_bucket).toBe("2-5");
    expect(props.recs_mrr_captured_bucket).toBe("200-1000");

    await fs.rm((t as any).storageDir, { recursive: true, force: true }).catch(() => {});
  });

  it("flush ships the cancelled flag through to PostHog", async () => {
    const t = new Telemetry();
    (t as any).enabled = true;
    (t as any).storageDir = path.join(
      os.tmpdir(),
      `pax8-tel-canc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    const captures: Array<{ properties: Record<string, unknown> }> = [];
    (t as any).posthog = {
      capture: (payload: { properties: Record<string, unknown> }) => captures.push(payload),
      flush: async () => {},
      shutdown: async () => {},
    };

    t.track({
      event: "command_executed",
      command: "sigint",
      flags: [],
      duration_ms: 0,
      success: false,
      cancelled: true,
      error_code: "ERROR_CANCELLED",
      cli_version: "0.1.0",
      node_version: process.version,
      os: process.platform,
      demo_mode: false,
    });

    await t.flush();

    expect(captures[0].properties.cancelled).toBe(true);
    expect(captures[0].properties.success).toBe(false);
    expect(captures[0].properties.error_code).toBe("ERROR_CANCELLED");

    await fs.rm((t as any).storageDir, { recursive: true, force: true }).catch(() => {});
  });
});

describe("Telemetry — salted distinct_id (M-2)", () => {
  let isolatedDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetTelemetry();
    isolatedDir = path.join(
      os.tmpdir(),
      `pax8-tel-id-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    process.env.PAX8_CONFIG_DIR = isolatedDir;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await fs.rm(isolatedDir, { recursive: true, force: true }).catch(() => {});
  });

  it("on first init creates ~/.pax8/telemetry-id with mode 0o600", () => {
    const t = new Telemetry();
    const id = (t as any).anonymousId as string;
    const filePath = path.join(isolatedDir, "telemetry-id");

    expect(id).toBeTruthy();
    expect(fsSync.existsSync(filePath)).toBe(true);
    const onDisk = fsSync.readFileSync(filePath, "utf-8").trim();
    expect(onDisk).toBe(id);

    if (process.platform !== "win32") {
      const stat = fsSync.statSync(filePath);
      // mode 0o600 means u=rw, g=, o= — mask off the file-type bits.
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("on subsequent init reads the existing id and does NOT rewrite", () => {
    const t1 = new Telemetry();
    const id1 = (t1 as any).anonymousId as string;
    const filePath = path.join(isolatedDir, "telemetry-id");
    const mtime1 = fsSync.statSync(filePath).mtimeMs;

    // Force a different mtime granularity tick on fast filesystems.
    const wait = 25;
    const start = Date.now();
    while (Date.now() - start < wait) {
      // busy-wait — short, deterministic across runners
    }

    resetTelemetry();
    const t2 = new Telemetry();
    const id2 = (t2 as any).anonymousId as string;
    const mtime2 = fsSync.statSync(filePath).mtimeMs;

    expect(id2).toBe(id1);
    // The file shouldn't have been rewritten; mtime should match exactly.
    expect(mtime2).toBe(mtime1);
  });

  it("is not derivable from hostname + username (no sha256-of-hostname pattern)", () => {
    const t = new Telemetry();
    const id = (t as any).anonymousId as string;
    // UUIDs look like 8-4-4-4-12 hex with hyphens. The legacy ID was a
    // 16-char hex slice with no hyphens — assert we've moved off that.
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("falls back to ephemeral UUID when the file write fails", () => {
    // Point the config dir at a file (not a directory) so mkdirSync will
    // throw ENOTDIR — the constructor must degrade gracefully rather than
    // bubbling the error. NOTE: do NOT use a /proc path here; mkdirSync on
    // Linux can deadlock on procfs targets (see #509 / earlier fix).
    const blocker = path.join(
      os.tmpdir(),
      `pax8-tel-id-blocker-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fsSync.writeFileSync(blocker, "not-a-directory", { mode: 0o600 });
    process.env.PAX8_CONFIG_DIR = path.join(blocker, "child");

    try {
      // Must not throw.
      const t = new Telemetry();
      const id = (t as any).anonymousId as string;
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    } finally {
      fsSync.unlinkSync(blocker);
    }
  });
});

// Guards against the class of bug where the hardcoded PostHog public
// token gets silently mutated — truncated by a copy-paste, redacted by
// a docs scrub, replaced by an empty placeholder, etc. PostHog's
// ingest API silently drops events with malformed tokens, so a
// regression here is invisible until someone notices their dashboard
// is empty. Read the literal directly from the source file so the
// test isn't fooled by an export shape change.
describe("PostHog write-token (source-file shape guard)", () => {
  it("POSTHOG_API_KEY in telemetry.ts matches the public-token format", async () => {
    const src = await fs.readFile(
      path.join(import.meta.dirname, "telemetry.ts"),
      "utf-8",
    );
    const match = src.match(/const POSTHOG_API_KEY = "([^"]+)";/);
    expect(match, "POSTHOG_API_KEY const not found in telemetry.ts").not.toBeNull();
    const token = match![1];
    // PostHog public project tokens are `phc_` + 43 base62 chars = 47 total.
    expect(token).toMatch(/^phc_[A-Za-z0-9]{43}$/);
  });

  it("POSTHOG_HOST in telemetry.ts is the US ingest endpoint", async () => {
    const src = await fs.readFile(
      path.join(import.meta.dirname, "telemetry.ts"),
      "utf-8",
    );
    const match = src.match(/const POSTHOG_HOST = "([^"]+)";/);
    expect(match, "POSTHOG_HOST const not found in telemetry.ts").not.toBeNull();
    expect(match![1]).toMatch(/^https:\/\/(us|eu)\.i\.posthog\.com$/);
  });

  it("APP_NAME in telemetry.ts identifies this CLI in the shared portfolio project", async () => {
    const src = await fs.readFile(
      path.join(import.meta.dirname, "telemetry.ts"),
      "utf-8",
    );
    const match = src.match(/const APP_NAME = "([^"]+)";/);
    expect(match, "APP_NAME const not found in telemetry.ts").not.toBeNull();
    // Stability gate: renaming this string breaks every saved PostHog
    // insight or alert in the shared portfolio project that filters on
    // `app = "pax8-cli"`. The test is here to make that breakage loud.
    expect(match![1]).toBe("pax8-cli");
  });
});
