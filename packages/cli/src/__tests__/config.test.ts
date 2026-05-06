// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

describe("pax8 config", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-config-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("config path", () => {
    it("prints the config directory path", async () => {
      const result = await runCliExpectSuccess(["config", "path"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout.trim()).toBe(tmpDir);
    });
  });

  describe("config init", () => {
    it("creates or reports existing config", async () => {
      const result = await runCliExpectSuccess(["config", "init", "--force"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("Config created");
      expect(result.stdout).toContain("config.yaml");
    });

    it("outputs YAML content", async () => {
      const result = await runCliExpectSuccess(["config", "init", "--force"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("version:");
      expect(result.stdout).toContain("output_format");
    });
  });

  describe("config show", () => {
    it("displays config after init", async () => {
      // Ensure config exists
      await runCliExpectSuccess(["config", "init", "--force"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      const result = await runCliExpectSuccess(["config", "show"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("version:");
      expect(result.stdout).toContain("output_format");
    });
  });

  describe("config set", () => {
    it("sets a config value", async () => {
      // Ensure config exists
      await runCliExpectSuccess(["config", "init", "--force"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      const result = await runCliExpectSuccess(
        ["config", "set", "defaults.page_size", "25"],
        { PAX8_CONFIG_DIR: tmpDir },
      );
      expect(result.stdout).toContain("Set defaults.page_size = 25");
    });

    it("shows help with examples", async () => {
      const result = await runCliExpectSuccess(["config", "set", "--help"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("Examples:");
      expect(result.stdout).toContain("defaults.output_format");
    });
  });

  describe("config --help", () => {
    it("shows config subcommands", async () => {
      const result = await runCliExpectSuccess(["config", "--help"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("init");
      expect(result.stdout).toContain("show");
      expect(result.stdout).toContain("set");
      expect(result.stdout).toContain("path");
    });
  });
});
