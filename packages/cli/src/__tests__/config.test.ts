import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";
import * as os from "node:os";
import * as path from "node:path";

describe("pax8 config", () => {
  describe("config path", () => {
    it("prints the config directory path", async () => {
      const result = await runCliExpectSuccess(["config", "path"]);
      const expected = path.join(os.homedir(), ".pax8");
      expect(result.stdout.trim()).toBe(expected);
    });
  });

  describe("config init", () => {
    it("creates or reports existing config", async () => {
      const result = await runCliExpectSuccess(["config", "init", "--force"]);
      expect(result.stdout).toContain("Config created");
      expect(result.stdout).toContain("config.yaml");
    });

    it("outputs YAML content", async () => {
      const result = await runCliExpectSuccess(["config", "init", "--force"]);
      expect(result.stdout).toContain("version:");
      expect(result.stdout).toContain("output_format");
    });
  });

  describe("config show", () => {
    it("displays config after init", async () => {
      // Ensure config exists
      await runCliExpectSuccess(["config", "init", "--force"]);
      const result = await runCliExpectSuccess(["config", "show"]);
      expect(result.stdout).toContain("version:");
      expect(result.stdout).toContain("output_format");
    });
  });

  describe("config set", () => {
    it("sets a config value", async () => {
      // Ensure config exists
      await runCliExpectSuccess(["config", "init", "--force"]);
      const result = await runCliExpectSuccess([
        "config",
        "set",
        "defaults.page_size",
        "25",
      ]);
      expect(result.stdout).toContain("Set defaults.page_size = 25");
    });

    it("shows help with examples", async () => {
      const result = await runCliExpectSuccess([
        "config",
        "set",
        "--help",
      ]);
      expect(result.stdout).toContain("Examples:");
      expect(result.stdout).toContain("defaults.output_format");
    });
  });

  describe("config --help", () => {
    it("shows config subcommands", async () => {
      const result = await runCliExpectSuccess(["config", "--help"]);
      expect(result.stdout).toContain("init");
      expect(result.stdout).toContain("show");
      expect(result.stdout).toContain("set");
      expect(result.stdout).toContain("path");
    });
  });
});
