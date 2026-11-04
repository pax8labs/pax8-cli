// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCli, runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";
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

  /**
   * #729 — `config set` used to write a config.yaml with no `version` key
   * whenever the dir had no file yet. That file fails schema validation and
   * is silently discarded on every later load, so the setting never applied
   * while the command reported "✓ Set demo = true". Reported as "config set
   * demo does nothing"; the key was never the problem.
   */
  describe("config set writes a schema-valid file (#729)", () => {
    it("stamps version when creating the config from scratch", async () => {
      await runCliExpectSuccess(["config", "set", "demo", "true"], {
        PAX8_CONFIG_DIR: tmpDir,
        PAX8_DEMO: "",
      });
      const written = await fs.readFile(path.join(tmpDir, "config.yaml"), "utf-8");
      expect(written).toContain('version: "1.0"');
      expect(written).toContain("demo: true");
    });

    it("makes the value it reports actually take effect", async () => {
      // The end-to-end property the original report was about: set demo,
      // then a data command runs against the fixture rather than failing
      // with "Not authenticated".
      await runCliExpectSuccess(["config", "set", "demo", "true"], {
        PAX8_CONFIG_DIR: tmpDir,
        PAX8_DEMO: "",
      });
      const result = await runCliExpectSuccess(["clients", "list", "--json"], {
        PAX8_CONFIG_DIR: tmpDir,
        PAX8_DEMO: "",
      });
      expect(JSON.parse(result.stdout).companies.length).toBeGreaterThan(0);
    });

    it("refuses a value the schema rejects, and writes nothing", async () => {
      await runCliExpectSuccess(["config", "init", "--force"], { PAX8_CONFIG_DIR: tmpDir });
      const before = await fs.readFile(path.join(tmpDir, "config.yaml"), "utf-8");

      const result = await runCliExpectFailure(["config", "set", "defaults.page_size", "999"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stderr).toContain("page_size");

      const after = await fs.readFile(path.join(tmpDir, "config.yaml"), "utf-8");
      expect(after, "an invalid value must not reach disk").toBe(before);
    });

    it("refuses a key the schema doesn't know rather than silently dropping it", async () => {
      // ConfigSchema strips unknown keys, so without this check the write
      // "succeeds" and the key vanishes on the next read.
      const result = await runCliExpectFailure(["config", "set", "nonsense", "true"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stderr).toContain("not a recognized configuration key");
    });
  });

  /**
   * #729, second half — a malformed config.yaml is the user's own file, but
   * a bare ZodError reaching the CLI renderer is reported as an API problem.
   */
  describe("an invalid config on disk reports itself as a config problem (#729)", () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(tmpDir, "config.yaml"), "demo: true\n", "utf-8");
    });

    it("names the file instead of blaming the Pax8 API", async () => {
      const result = await runCliExpectFailure(["demo", "on"], {
        PAX8_CONFIG_DIR: tmpDir,
        PAX8_DEMO: "",
      });
      expect(result.stderr).toContain("config file is not valid");
      expect(result.stderr).toContain("config.yaml");
      expect(
        result.stderr,
        "no request was made; the API must not be blamed for a local file",
      ).not.toContain("Pax8 API returned an unexpected response");
    });

    it("warns once on stderr when falling back to defaults, keeping stdout clean", async () => {
      const result = await runCli(["clients", "list", "--json"], {
        PAX8_CONFIG_DIR: tmpDir,
        PAX8_DEMO: "1",
      });
      expect(result.stderr).toContain("Ignoring invalid config");
      expect(result.stderr.match(/Ignoring invalid config/g)?.length).toBe(1);
      // stdout stays a clean JSON envelope — the warning is stderr-only.
      expect(() => JSON.parse(result.stdout)).not.toThrow();
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
