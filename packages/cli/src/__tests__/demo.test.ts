// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

describe("pax8 demo on|off|status", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-demo-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("`demo on` persists demo: true to config.yaml", async () => {
    const result = await runCliExpectSuccess(["demo", "on"], {
      PAX8_CONFIG_DIR: tmpDir,
      PAX8_DEMO: "",
    });
    expect(result.stdout).toContain("Demo mode enabled");

    const yaml = await fs.readFile(path.join(tmpDir, "config.yaml"), "utf-8");
    expect(yaml).toMatch(/demo:\s*true/);
  });

  it("`demo off` persists demo: false to config.yaml", async () => {
    await runCliExpectSuccess(["demo", "on"], { PAX8_CONFIG_DIR: tmpDir, PAX8_DEMO: "" });
    const result = await runCliExpectSuccess(["demo", "off"], {
      PAX8_CONFIG_DIR: tmpDir,
      PAX8_DEMO: "",
    });
    expect(result.stdout).toContain("Demo mode disabled");

    const yaml = await fs.readFile(path.join(tmpDir, "config.yaml"), "utf-8");
    expect(yaml).toMatch(/demo:\s*false/);
  });

  it("`demo status --json` reports default (no env, no config)", async () => {
    const result = await runCliExpectSuccess(["demo", "status", "--json"], {
      PAX8_CONFIG_DIR: tmpDir,
      PAX8_DEMO: "",
    });
    expect(JSON.parse(result.stdout)).toEqual({ enabled: false, source: "default" });
  });

  it("`demo status --json` reports config source after `demo on`", async () => {
    await runCliExpectSuccess(["demo", "on"], { PAX8_CONFIG_DIR: tmpDir, PAX8_DEMO: "" });
    const result = await runCliExpectSuccess(["demo", "status", "--json"], {
      PAX8_CONFIG_DIR: tmpDir,
      PAX8_DEMO: "",
    });
    expect(JSON.parse(result.stdout)).toEqual({ enabled: true, source: "config" });
  });

  it("PAX8_DEMO=1 env wins over `demo off` in config", async () => {
    await runCliExpectSuccess(["demo", "off"], { PAX8_CONFIG_DIR: tmpDir, PAX8_DEMO: "" });
    const result = await runCliExpectSuccess(["demo", "status", "--json"], {
      PAX8_CONFIG_DIR: tmpDir,
      PAX8_DEMO: "1",
    });
    expect(JSON.parse(result.stdout)).toEqual({ enabled: true, source: "env" });
  });

  it("PAX8_DEMO=0 env wins over `demo on` in config", async () => {
    await runCliExpectSuccess(["demo", "on"], { PAX8_CONFIG_DIR: tmpDir, PAX8_DEMO: "" });
    const result = await runCliExpectSuccess(["demo", "status", "--json"], {
      PAX8_CONFIG_DIR: tmpDir,
      PAX8_DEMO: "0",
    });
    expect(JSON.parse(result.stdout)).toEqual({ enabled: false, source: "env" });
  });

  it("`demo on` warns to stderr if PAX8_DEMO=0 env will override", async () => {
    const result = await runCli(["demo", "on"], {
      PAX8_CONFIG_DIR: tmpDir,
      PAX8_DEMO: "0",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Demo mode enabled");
    expect(result.stderr).toContain("PAX8_DEMO=0");
    expect(result.stderr).toContain("overrides this config");
  });

  it("`demo on` is idempotent", async () => {
    await runCliExpectSuccess(["demo", "on"], { PAX8_CONFIG_DIR: tmpDir, PAX8_DEMO: "" });
    const second = await runCliExpectSuccess(["demo", "on"], {
      PAX8_CONFIG_DIR: tmpDir,
      PAX8_DEMO: "",
    });
    expect(second.stdout).toContain("Demo mode enabled");
  });

  it("after `demo on`, a subsequent demo command runs in demo mode without env var", async () => {
    await runCliExpectSuccess(["demo", "on"], { PAX8_CONFIG_DIR: tmpDir, PAX8_DEMO: "" });
    // `dashboard` uses MockPax8Client only in demo mode — if the config flag
    // is honored, this runs without auth errors.
    const result = await runCliExpectSuccess(["dashboard", "--json"], {
      PAX8_CONFIG_DIR: tmpDir,
      PAX8_DEMO: "",
    });
    const data = JSON.parse(result.stdout);
    expect(data.totalCompanies).toBeGreaterThan(0);
    expect(result.stderr).toContain("Demo mode");
  });
});
