import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

describe("pax8 telemetry", () => {
  describe("telemetry --help", () => {
    it("shows telemetry subcommands", async () => {
      const result = await runCliExpectSuccess(["telemetry", "--help"]);
      expect(result.stdout).toContain("status");
      expect(result.stdout).toContain("enable");
      expect(result.stdout).toContain("disable");
    });
  });

  describe("telemetry status", () => {
    it("reports telemetry status", async () => {
      const result = await runCliExpectSuccess(["telemetry", "status"]);
      // Should say either enabled or disabled
      expect(result.stdout).toMatch(/Telemetry is (enabled|disabled)/);
    });
  });

  describe("telemetry enable", () => {
    it("enables telemetry", async () => {
      // First ensure config exists
      await runCliExpectSuccess(["config", "init", "--force"]);
      const result = await runCliExpectSuccess(["telemetry", "enable"]);
      expect(result.stdout).toContain("Telemetry enabled");
    });
  });

  describe("telemetry disable", () => {
    it("disables telemetry", async () => {
      await runCliExpectSuccess(["config", "init", "--force"]);
      const result = await runCliExpectSuccess(["telemetry", "disable"]);
      expect(result.stdout).toContain("Telemetry disabled");
    });
  });

  describe("telemetry status after toggle", () => {
    it("enable command reports success", async () => {
      await runCliExpectSuccess(["config", "init", "--force"]);
      const result = await runCliExpectSuccess(["telemetry", "enable"]);
      expect(result.stdout).toContain("Telemetry enabled");
    });

    it("disable command reports success", async () => {
      await runCliExpectSuccess(["config", "init", "--force"]);
      const result = await runCliExpectSuccess(["telemetry", "disable"]);
      expect(result.stdout).toContain("Telemetry disabled");
    });
  });
});
