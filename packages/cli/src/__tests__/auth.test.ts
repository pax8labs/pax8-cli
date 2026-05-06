import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("pax8 auth", () => {
  describe("auth login", () => {
    it("succeeds in demo mode", async () => {
      const result = await runCliExpectSuccess(["auth", "login"]);
      expect(result.stdout).toContain("Authenticated");
      expect(result.stdout).toContain("demo mode");
    });

    it("shows help text with examples", async () => {
      const result = await runCliExpectSuccess(["auth", "login", "--help"]);
      expect(result.stdout).toContain("client-id");
      expect(result.stdout).toContain("client-secret");
      expect(result.stdout).toContain("Examples:");
    });
  });

  describe("auth status", () => {
    it("shows demo mode status", async () => {
      const result = await runCliExpectSuccess(["auth", "status"]);
      expect(result.stdout).toContain("Authenticated");
      expect(result.stdout).toContain("demo mode");
      expect(result.stdout).toContain("Demo");
    });

    it("shows mock data message", async () => {
      const result = await runCliExpectSuccess(["auth", "status"]);
      expect(result.stdout).toContain("mock data");
    });
  });

  describe("auth logout", () => {
    it("succeeds in demo mode", async () => {
      const result = await runCliExpectSuccess(["auth", "logout"]);
      expect(result.stdout).toContain("Logged out");
      expect(result.stdout).toContain("demo mode");
    });
  });

  describe("auth --help", () => {
    it("shows auth subcommands", async () => {
      const result = await runCliExpectSuccess(["auth", "--help"]);
      expect(result.stdout).toContain("login");
      expect(result.stdout).toContain("status");
      expect(result.stdout).toContain("logout");
    });
  });
});
