// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

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

    it("accepts credentials via flags (non-interactive path)", async () => {
      // Demo mode short-circuits before validation, but the flag-parsing
      // path still runs — proves the non-interactive contract is intact.
      const result = await runCliExpectSuccess([
        "auth",
        "login",
        "--client-id",
        "test-id",
        "--client-secret",
        "test-secret",
      ]);
      expect(result.stdout).toContain("Authenticated");
    });

    it("errors cleanly when stdin is non-TTY and no credentials are supplied", async () => {
      // execFile pipes stdin (non-TTY) so the interactive prompt path is skipped.
      // PAX8_DEMO must be off so we hit the credential-check branch.
      const result = await runCli(["auth", "login"], {
        PAX8_DEMO: "",
        PAX8_CLIENT_ID: "",
        PAX8_CLIENT_SECRET: "",
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/Missing credentials|client-id/);
    });
  });

  describe("auth status", () => {
    // Subprocess stdout is non-TTY, so per the agent-first contract (#210)
    // `auth status` auto-emits JSON. We assert on the structured shape and
    // separately verify the human path via the explicit format helpers.
    it("emits JSON in non-TTY (agent-first default)", async () => {
      const result = await runCliExpectSuccess(["auth", "status"]);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.authenticated).toBe(true);
      expect(parsed.mode).toBe("demo");
    });

    it("emits JSON when --json is passed explicitly", async () => {
      const result = await runCliExpectSuccess(["auth", "status", "--json"]);
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toEqual({ authenticated: true, mode: "demo" });
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
