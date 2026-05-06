// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, saveConfig } from "./loader.js";
import { type Config } from "./schema.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("config/loader", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `pax8-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("should return defaults when no file exists", async () => {
    const config = await loadConfig(path.join(tmpDir, "nonexistent.yaml"));
    expect(config.version).toBe("1.0");
    expect(config.defaults.output_format).toBe("table");
    expect(config.defaults.page_size).toBe(50);
    expect(config.defaults.confirm_destructive).toBe(true);
    expect(config.cache.enabled).toBe(true);
    expect(config.cache.ttl_hours).toBe(24);
    expect(config.telemetry.enabled).toBe(false);
  });

  it("should load config from YAML file", async () => {
    const yamlContent = `version: "1.0"
auth:
  client_id: "test-id"
defaults:
  output_format: json
  page_size: 25
`;
    const configPath = path.join(tmpDir, "config.yaml");
    await fs.writeFile(configPath, yamlContent, "utf-8");

    const config = await loadConfig(configPath);
    expect(config.version).toBe("1.0");
    expect(config.auth?.client_id).toBe("test-id");
    expect(config.defaults.output_format).toBe("json");
    expect(config.defaults.page_size).toBe(25);
    // Defaults should be applied for missing fields
    expect(config.defaults.confirm_destructive).toBe(true);
    expect(config.cache.enabled).toBe(true);
  });

  it("should save and reload config", async () => {
    const configPath = path.join(tmpDir, "config.yaml");
    const config: Config = {
      version: "1.0",
      auth: { client_id: "saved-id" },
      defaults: {
        output_format: "csv",
        page_size: 75,
        confirm_destructive: false,
      },
      cache: {
        enabled: false,
        ttl_hours: 12,
      },
      telemetry: {
        enabled: true,
      },
    };

    await saveConfig(config, configPath);
    const loaded = await loadConfig(configPath);
    expect(loaded.version).toBe("1.0");
    expect(loaded.auth?.client_id).toBe("saved-id");
    expect(loaded.defaults.output_format).toBe("csv");
    expect(loaded.defaults.page_size).toBe(75);
    expect(loaded.cache.enabled).toBe(false);
    expect(loaded.telemetry.enabled).toBe(true);
  });

  it("should reject invalid config (wrong version)", async () => {
    const yamlContent = `version: "2.0"
defaults:
  output_format: table
`;
    const configPath = path.join(tmpDir, "bad-config.yaml");
    await fs.writeFile(configPath, yamlContent, "utf-8");

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("should reject invalid config (bad output_format)", async () => {
    const yamlContent = `version: "1.0"
defaults:
  output_format: xml
`;
    const configPath = path.join(tmpDir, "bad-config.yaml");
    await fs.writeFile(configPath, yamlContent, "utf-8");

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("should reject invalid config (page_size out of range)", async () => {
    const yamlContent = `version: "1.0"
defaults:
  page_size: 500
`;
    const configPath = path.join(tmpDir, "bad-config.yaml");
    await fs.writeFile(configPath, yamlContent, "utf-8");

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("should create directory when saving to non-existent path", async () => {
    const configPath = path.join(tmpDir, "nested", "dir", "config.yaml");
    const config: Config = {
      version: "1.0",
      defaults: { output_format: "table", page_size: 50, confirm_destructive: true },
      cache: { enabled: true, ttl_hours: 24 },
      telemetry: { enabled: false },
    };

    await saveConfig(config, configPath);
    const loaded = await loadConfig(configPath);
    expect(loaded.version).toBe("1.0");
  });
});
