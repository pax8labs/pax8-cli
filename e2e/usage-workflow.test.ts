import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("E2E: Usage workflow — list and show summaries", () => {
  it("pax8 usage list returns JSON when piped", async () => {
    const result = await runCliExpectSuccess(["usage", "list"]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    const first = data[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("date");
    expect(first).toHaveProperty("quantity");
    expect(first).toHaveProperty("unitPrice");
    expect(first).toHaveProperty("subtotal");
  });

  it("pax8 usage list --company filters by company name", async () => {
    const result = await runCliExpectSuccess([
      "usage",
      "list",
      "--company",
      "Redwood Manufacturing",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    for (const u of data) {
      expect(u.companyName).toBe("Redwood Manufacturing");
    }
  });

  it("pax8 usage list --month filters client-side by date prefix", async () => {
    // Demo data has summaries dated currentMonth-15 and lastMonth-15.
    // Pull all, pick one month, then re-query with that month and confirm.
    const all = await runCliExpectSuccess(["usage", "list", "--json"]);
    const allData = JSON.parse(all.stdout);
    expect(allData.length).toBeGreaterThan(0);
    const targetMonth = String(allData[0].date).slice(0, 7);

    const filtered = await runCliExpectSuccess([
      "usage",
      "list",
      "--month",
      targetMonth,
      "--json",
    ]);
    const filteredData = JSON.parse(filtered.stdout);
    expect(filteredData.length).toBeGreaterThan(0);
    for (const u of filteredData) {
      expect(String(u.date).startsWith(targetMonth)).toBe(true);
    }
  });

  it("pax8 usage show returns a single summary as JSON array", async () => {
    const list = await runCliExpectSuccess(["usage", "list", "--json"]);
    const id = JSON.parse(list.stdout)[0].id;

    const result = await runCliExpectSuccess(["usage", "show", id, "--json"]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(id);
  });

  it("pax8 usage show --lines includes per-resource breakdown", async () => {
    const list = await runCliExpectSuccess(["usage", "list", "--json"]);
    // Pick a summary with known line items
    const summary = JSON.parse(list.stdout).find(
      (u: { id: string }) => u.id === "usage-redwood-acronis-curr",
    );
    expect(summary).toBeDefined();

    const result = await runCliExpectSuccess([
      "usage",
      "show",
      summary.id,
      "--lines",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data[0]).toHaveProperty("lines");
    expect(Array.isArray(data[0].lines)).toBe(true);
    expect(data[0].lines.length).toBeGreaterThan(0);
    expect(data[0].lines[0]).toHaveProperty("description");
    expect(data[0].lines[0]).toHaveProperty("subtotal");
    expect(data[0].lines[0].usageSummaryId).toBe(summary.id);
  });

  it("pax8 usage show fails for unknown summary id", async () => {
    const result = await runCliExpectFailure([
      "usage",
      "show",
      "definitely-not-a-real-id",
    ]);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("pax8 usage list --csv includes the expected columns", async () => {
    const result = await runCliExpectSuccess(["usage", "list", "--csv"]);
    const header = result.stdout.split("\n")[0].toLowerCase();
    expect(header).toContain("id");
    expect(header).toContain("subtotal");
  });

  it("pax8 usage list --ids-only emits one ID per line", async () => {
    const result = await runCliExpectSuccess(["usage", "list", "--ids-only"]);
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // demo IDs have form "usage-..."; live API IDs would be UUIDs.
      // Just verify it's a single non-empty token, no whitespace.
      expect(line).toMatch(/^\S+$/);
    }
  });
});
