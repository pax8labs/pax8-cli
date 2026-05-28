// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { runCliExpectSuccess } from "./test-utils.js";
import { checkMcp } from "../commands/doctor.js";

describe("pax8 doctor", () => {
  // Subprocess stdout is non-TTY, so per the agent-first contract the default
  // resolves to "json". These tests exercise the human/table render path and
  // pin format=table via PAX8_OUTPUT_FORMAT so the ANSI banner + per-check
  // lines stay visible (the rendered branch they're asserting on).
  const TABLE = { PAX8_OUTPUT_FORMAT: "table" };

  it("runs diagnostics in demo mode", async () => {
    const result = await runCliExpectSuccess(["doctor"], TABLE);
    expect(result.stdout).toContain("Diagnostics");
    expect(result.stdout).toContain("Node.js version");
  });

  it("reports node version check as passing", async () => {
    const result = await runCliExpectSuccess(["doctor"], TABLE);
    // Node 20+ should pass
    expect(result.stdout).toMatch(/✓.*Node\.js version/);
  });

  it("reports auth configured in demo mode", async () => {
    const result = await runCliExpectSuccess(["doctor"], TABLE);
    expect(result.stdout).toMatch(/✓.*Authentication configured/);
    expect(result.stdout).toContain("Demo mode");
  });

  it("reports token fetch skipped in demo mode", async () => {
    const result = await runCliExpectSuccess(["doctor"], TABLE);
    expect(result.stdout).toMatch(/✓.*Token fetch/);
    expect(result.stdout).toContain("Skipped");
  });

  it("reports cache status", async () => {
    const result = await runCliExpectSuccess(["doctor"], TABLE);
    expect(result.stdout).toMatch(/✓.*Cache/);
  });

  // Regression for #220: env-var auth and demo mode are equally valid
  // credential paths; doctor should not ✗ "Config file" when either covers
  // it. Previously it always ✗'d on a missing file, scaring CI runners and
  // users with PAX8_CLIENT_ID/SECRET set but no on-disk config.
  describe("Config file check (#220)", () => {
    it("passes with 'demo mode' detail when PAX8_DEMO=1 and no config file", async () => {
      const result = await runCliExpectSuccess(["doctor"], TABLE);
      // Test isolation (#287) gives this run a fresh PAX8_CONFIG_DIR with
      // no config.yaml; PAX8_DEMO=1 is the test default. Should pass.
      expect(result.stdout).toMatch(/✓\s+Config file/);
      expect(result.stdout).toContain("demo mode");
    });

    it("passes with 'using env vars' detail when PAX8_CLIENT_ID/SECRET set and no config file", async () => {
      const result = await runCliExpectSuccess(["doctor"], {
        ...TABLE,
        // Override the test-default PAX8_DEMO=1 so the env-var branch fires.
        PAX8_DEMO: "",
        PAX8_CLIENT_ID: "fake-id-for-test",
        PAX8_CLIENT_SECRET: "fake-secret-for-test",
      });
      expect(result.stdout).toMatch(/✓\s+Config file/);
      expect(result.stdout).toContain("env vars");
    });
  });

  it("shows help text", async () => {
    const result = await runCliExpectSuccess(["doctor", "--help"]);
    expect(result.stdout).toContain("diagnostic");
    expect(result.stdout).toContain("Examples:");
  });

  it("reports the default API base URL when PAX8_API_BASE is unset", async () => {
    const result = await runCliExpectSuccess(["doctor"], { ...TABLE, PAX8_API_BASE: "" });
    expect(result.stdout).toMatch(/✓.*API base URL/);
    expect(result.stdout).toContain("https://api.pax8.com/v1");
    expect(result.stdout).toContain("default");
  });

  it("reports the overridden API base URL when PAX8_API_BASE is set", async () => {
    const result = await runCliExpectSuccess(["doctor"], {
      ...TABLE,
      PAX8_API_BASE: "https://api-staging.pax8.com/v1",
    });
    expect(result.stdout).toMatch(/✓.*API base URL/);
    expect(result.stdout).toContain("https://api-staging.pax8.com/v1");
    expect(result.stdout).toContain("overridden via PAX8_API_BASE");
    // staging != prod, so it should also flag "non-prod"
    expect(result.stdout).toContain("non-prod");
  });

  it("does not flag non-prod when PAX8_API_BASE is explicitly set to the prod URL", async () => {
    const result = await runCliExpectSuccess(["doctor"], {
      ...TABLE,
      PAX8_API_BASE: "https://api.pax8.com/v1",
    });
    expect(result.stdout).toMatch(/✓.*API base URL/);
    expect(result.stdout).toContain("overridden via PAX8_API_BASE");
    expect(result.stdout).not.toContain("non-prod");
  });

  // Regression for #470: `pax8 doctor --json` previously ignored the flag and
  // wrote the ANSI banner to stdout, breaking `pax8 doctor --json | jq`. The
  // contract now is: stdout is the structured envelope, banner is suppressed
  // entirely in --json mode.
  describe("--json mode (#470)", () => {
    it("emits a structured envelope on stdout that parses as JSON", async () => {
      const result = await runCliExpectSuccess(["doctor", "--json"]);
      const parsed = JSON.parse(result.stdout);
      expect(Array.isArray(parsed.checks)).toBe(true);
      expect(parsed.checks.length).toBeGreaterThan(0);
      // Every check has the documented shape
      for (const check of parsed.checks) {
        expect(typeof check.name).toBe("string");
        expect(typeof check.passed).toBe("boolean");
      }
      expect(parsed.summary).toBeDefined();
      expect(typeof parsed.summary.passed).toBe("number");
      expect(typeof parsed.summary.failed).toBe("number");
      expect(typeof parsed.summary.allPassed).toBe("boolean");
      expect(typeof parsed.version).toBe("string");
      expect(Array.isArray(parsed.nextActions)).toBe(true);
    });

    it("does not write the ANSI banner to stdout in --json mode", async () => {
      const result = await runCliExpectSuccess(["doctor", "--json"]);
      // The human banner ("Pax8 CLI — Diagnostics") must not appear in JSON
      // stdout — it would break `jq` and any other JSON consumer.
      expect(result.stdout).not.toContain("Pax8 CLI — Diagnostics");
      // Per-check rendered icons (the literal "✓ Node.js version" lines from
      // the human path) must also be absent.
      expect(result.stdout).not.toMatch(/^\s*✓\s+Node\.js/m);
    });
  });
});

describe("checkMcp", () => {
  it("passes with skip detail when .mcp.json is not found anywhere up the tree", async () => {
    // Create an isolated temp dir whose root has no .mcp.json by walking up
    // (mkdtemp uses os.tmpdir() so the walk hits / without finding one).
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-doctor-mcp-"));
    try {
      // Force non-demo so the demo-mode early-return doesn't mask the file lookup.
      const prev = process.env.PAX8_DEMO;
      delete process.env.PAX8_DEMO;
      try {
        const fetchImpl = (() => {
          throw new Error("fetch should not be called when .mcp.json is missing");
        }) as unknown as typeof fetch;
        const result = await checkMcp({ cwd: tmp, fetchImpl });
        expect(result.passed).toBe(true);
        expect(result.detail).toContain(".mcp.json not found");
      } finally {
        if (prev !== undefined) process.env.PAX8_DEMO = prev;
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
