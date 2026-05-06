// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

describe("pax8 telemetry", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-telemetry-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("telemetry --help", () => {
    it("shows telemetry subcommands", async () => {
      const result = await runCliExpectSuccess(["telemetry", "--help"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("status");
      expect(result.stdout).toContain("enable");
      expect(result.stdout).toContain("disable");
    });
  });

  describe("telemetry status", () => {
    it("reports telemetry status", async () => {
      const result = await runCliExpectSuccess(["telemetry", "status"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      // Should say either enabled or disabled
      expect(result.stdout).toMatch(/Telemetry is (enabled|disabled)/);
    });
  });

  describe("telemetry enable", () => {
    it("enables telemetry", async () => {
      // First ensure config exists
      await runCliExpectSuccess(["config", "init", "--force"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      const result = await runCliExpectSuccess(["telemetry", "enable"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("Telemetry enabled");
    });
  });

  describe("telemetry disable", () => {
    it("disables telemetry", async () => {
      await runCliExpectSuccess(["config", "init", "--force"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      const result = await runCliExpectSuccess(["telemetry", "disable"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("Telemetry disabled");
    });
  });

  describe("telemetry status after toggle", () => {
    it("enable command reports success", async () => {
      await runCliExpectSuccess(["config", "init", "--force"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      const result = await runCliExpectSuccess(["telemetry", "enable"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("Telemetry enabled");
    });

    it("disable command reports success", async () => {
      await runCliExpectSuccess(["config", "init", "--force"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      const result = await runCliExpectSuccess(["telemetry", "disable"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("Telemetry disabled");
    });
  });
});
