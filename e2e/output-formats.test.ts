import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

const COMMANDS = [
  { name: "companies list", args: ["companies", "list"] },
  { name: "subscriptions list", args: ["subscriptions", "list"] },
  { name: "products list", args: ["products", "list"] },
  { name: "invoices list", args: ["invoices", "list"] },
];

describe("E2E: Output format consistency", () => {
  for (const cmd of COMMANDS) {
    describe(cmd.name, () => {
      it("default output has content (non-empty stdout)", async () => {
        const result = await runCliExpectSuccess(cmd.args);
        expect(result.stdout.trim().length).toBeGreaterThan(0);
      });

      it("--json produces valid JSON array of objects with expected keys", async () => {
        const result = await runCliExpectSuccess([...cmd.args, "--json"]);
        const data = JSON.parse(result.stdout);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThan(0);
        expect(typeof data[0]).toBe("object");
        expect(data[0]).not.toBeNull();
        // Every item should have an id
        expect(data[0]).toHaveProperty("id");
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
