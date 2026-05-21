// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

const COMMANDS = [
  { name: "companies list", args: ["clients", "list"], envelopeKey: "companies" },
  { name: "subscriptions list", args: ["subscriptions", "list"], envelopeKey: "subscriptions" },
  { name: "products list", args: ["products", "list"], envelopeKey: "products" },
  { name: "invoices list", args: ["invoices", "list"], envelopeKey: "invoices" },
];

describe("E2E: Output format consistency", () => {
  for (const cmd of COMMANDS) {
    describe(cmd.name, () => {
      it("default output has content (non-empty stdout)", async () => {
        const result = await runCliExpectSuccess(cmd.args);
        expect(result.stdout.trim().length).toBeGreaterThan(0);
      });

      it("--json produces valid { <resource>, page } envelope with expected keys (#483)", async () => {
        const result = await runCliExpectSuccess([...cmd.args, "--json"]);
        const data = JSON.parse(result.stdout) as Record<string, unknown>;
        expect(data).toHaveProperty(cmd.envelopeKey);
        expect(data).toHaveProperty("page");
        const items = data[cmd.envelopeKey] as Array<Record<string, unknown>>;
        expect(Array.isArray(items)).toBe(true);
        expect(items.length).toBeGreaterThan(0);
        expect(typeof items[0]).toBe("object");
        expect(items[0]).not.toBeNull();
        // Every item should have an id
        expect(items[0]).toHaveProperty("id");
      });

      it("--csv produces header row + data rows", async () => {
        const result = await runCliExpectSuccess([...cmd.args, "--csv"]);
        const lines = result.stdout.trim().split("\n");
        // At least header + 1 data row
        expect(lines.length).toBeGreaterThanOrEqual(2);
        // Header should contain comma-separated column names
        expect(lines[0]).toContain(",");
      });

      it("--quiet produces empty or minimal stdout", async () => {
        const result = await runCliExpectSuccess([...cmd.args, "--quiet"]);
        expect(result.stdout.trim()).toBe("");
      });
    });
  }
});
