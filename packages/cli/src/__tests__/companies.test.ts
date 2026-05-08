// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("pax8 companies", () => {
  describe("companies list", () => {
    it("returns company data in JSON format", async () => {
      const result = await runCliExpectSuccess(["companies", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("status");
    });

    it("outputs table format by default (non-TTY falls back to JSON)", async () => {
      const result = await runCliExpectSuccess(["companies", "list"]);
      // Non-TTY defaults to JSON
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].name).toBe("Summit Healthcare Partners");
    });

    it("outputs CSV format", async () => {
      const result = await runCliExpectSuccess(["companies", "list", "--csv"]);
      const lines = result.stdout.trim().split("\n");
      // First line is header
      expect(lines[0]).toContain("Company");
      expect(lines[0]).toContain("ID");
      expect(lines[0]).toContain("Status");
      // Data rows
      expect(lines.length).toBeGreaterThan(1);
      expect(lines[1]).toContain("Summit Healthcare Partners");
    });

    it("supports pagination options", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "list",
        "--page",
        "0",
        "--size",
        "2",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBe(2);
    });

    it("shows footer with company count on stderr", async () => {
      const result = await runCliExpectSuccess(["companies", "list"]);
      expect(result.stderr).toContain("companies");
    });

    it("--with-actions wraps in { companies, nextActions }", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "list",
        "--json",
        "--with-actions",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("companies");
      expect(data).toHaveProperty("nextActions");
      expect(Array.isArray(data.companies)).toBe(true);
      expect(Array.isArray(data.nextActions)).toBe(true);
      expect(data.nextActions.length).toBeGreaterThan(0);
      for (const action of data.nextActions) {
        expect(action).toHaveProperty("command");
        expect(action).toHaveProperty("description");
        expect(typeof action.command).toBe("string");
        expect(typeof action.description).toBe("string");
      }
    });
  });

  describe("companies show", () => {
    it("returns company details in JSON format", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "show",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      expect(data.name).toBe("Summit Healthcare Partners");
      expect(data.status).toBe("Active");
    });

    it("shows company detail view", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "show",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      ]);
      // Non-TTY defaults to JSON
      const data = JSON.parse(result.stdout);
      expect(data.name).toBe("Summit Healthcare Partners");
      expect(data.phone).toBeTruthy();
    });

    it("surfaces externalId in --json when present", async () => {
      // Summit Healthcare carries `externalId: "PSA-SUMMIT-1042"` in the
      // demo fixture — exercises the field surfaced in #273 (fixes #5).
      const result = await runCliExpectSuccess([
        "companies",
        "show",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("externalId");
      expect(data.externalId).toBe("PSA-SUMMIT-1042");
    });

    it("includes subscriptions with --subscriptions flag", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "show",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--subscriptions",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.subscriptions).toBeDefined();
      expect(Array.isArray(data.subscriptions)).toBe(true);
      expect(data.subscriptions.length).toBeGreaterThan(0);
      expect(data.subscriptions[0]).toHaveProperty("productName");
    });

    it("returns JSON with subscriptions included", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "show",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--subscriptions",
      ]);
      // Non-TTY outputs JSON
      const data = JSON.parse(result.stdout);
      expect(data.subscriptions).toBeDefined();
      expect(data.subscriptions.length).toBeGreaterThan(0);
    });
  });

  describe("companies --help", () => {
    it("shows companies subcommands", async () => {
      const result = await runCliExpectSuccess(["companies", "--help"]);
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("show");
      expect(result.stdout).toContain("create");
      expect(result.stdout).toContain("update");
    });

    it("shows list help with examples", async () => {
      const result = await runCliExpectSuccess(["companies", "list", "--help"]);
      expect(result.stdout).toContain("Examples:");
      expect(result.stdout).toContain("--page");
      expect(result.stdout).toContain("--size");
    });

    it("shows show help with examples", async () => {
      const result = await runCliExpectSuccess(["companies", "show", "--help"]);
      expect(result.stdout).toContain("Examples:");
      expect(result.stdout).toContain("--subscriptions");
    });

    it("shows create help with required options", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "create",
        "--help",
      ]);
      expect(result.stdout).toContain("--name");
      expect(result.stdout).toContain("Examples:");
    });

    it("shows update help with examples", async () => {
      const result = await runCliExpectSuccess([
        "companies",
        "update",
        "--help",
      ]);
      expect(result.stdout).toContain("--name");
      expect(result.stdout).toContain("--phone");
      expect(result.stdout).toContain("Examples:");
    });
  });
});
