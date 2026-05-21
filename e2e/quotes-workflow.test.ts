// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("E2E: Quotes workflow — list, show, write commands", () => {
  it("pax8 quotes list returns JSON when piped", async () => {
    const result = await runCliExpectSuccess(["quotes", "list"]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    const first = data[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("companyId");
    expect(first).toHaveProperty("status");
    expect(first).toHaveProperty("createdAt");
    expect(first).toHaveProperty("lineItems");
  });

  it("pax8 quotes list --company filters by company name", async () => {
    const result = await runCliExpectSuccess([
      "quotes",
      "list",
      "--company",
      "Summit Healthcare Partners",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    // Single company means only one unique companyId
    const ids = new Set(data.map((q: { companyId: string }) => q.companyId));
    expect(ids.size).toBeLessThanOrEqual(1);
  });

  it("pax8 quotes list --status filters client-side by status", async () => {
    const all = await runCliExpectSuccess(["quotes", "list", "--json"]);
    const allData = JSON.parse(all.stdout);
    expect(allData.length).toBeGreaterThan(0);
    const targetStatus = allData[0].status;

    const filtered = await runCliExpectSuccess([
      "quotes",
      "list",
      "--status",
      targetStatus,
      "--json",
    ]);
    const filteredData = JSON.parse(filtered.stdout);
    expect(filteredData.length).toBeGreaterThan(0);
    for (const q of filteredData) {
      expect(String(q.status).toLowerCase()).toBe(String(targetStatus).toLowerCase());
    }
  });

  it("pax8 quotes show returns a single quote object with computed total", async () => {
    const list = await runCliExpectSuccess(["quotes", "list", "--json"]);
    const id = JSON.parse(list.stdout)[0].id;

    const result = await runCliExpectSuccess(["quotes", "show", id, "--json"]);
    const data = JSON.parse(result.stdout);
    // `show` returns a single object, not an array (#208)
    expect(Array.isArray(data)).toBe(false);
    expect(data.id).toBe(id);
    expect(typeof data.total).toBe("number");
  });

  it("pax8 quotes show fails for unknown id", async () => {
    const result = await runCliExpectFailure([
      "quotes",
      "show",
      "definitely-not-a-real-quote-id",
    ]);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("pax8 quotes list --ids-only emits one ID per line", async () => {
    const result = await runCliExpectSuccess(["quotes", "list", "--ids-only"]);
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^\S+$/);
    }
  });

  it("pax8 quotes list --csv includes the expected columns", async () => {
    const result = await runCliExpectSuccess(["quotes", "list", "--csv"]);
    const header = result.stdout.split("\n")[0].toLowerCase();
    expect(header).toContain("id");
    expect(header).toContain("status");
  });

  it("pax8 quotes create with --yes returns the new quote", async () => {
    const result = await runCliExpectSuccess([
      "quotes",
      "create",
      "--company",
      "Summit Healthcare Partners",
      "--product",
      "prod-m365-e3-0003",
      "--quantity",
      "3",
      "--billing-term",
      "Annual",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].status).toBe("Draft");
    expect(data[0].lineItems).toHaveLength(1);
    expect(data[0].lineItems[0].quantity).toBe(3);
    expect(data[0].lineItems[0].billingTerm).toBe("Annual");
  });

  it("pax8 quotes create rejects an invalid quantity", async () => {
    const result = await runCliExpectFailure([
      "quotes",
      "create",
      "--company",
      "Summit Healthcare Partners",
      "--product",
      "prod-m365-e3-0003",
      "--quantity",
      "0",
      "--yes",
    ]);
    expect(result.stderr.toLowerCase()).toContain("quantity");
  });

  it("pax8 quotes update --expiration-date with --yes returns the updated quote", async () => {
    const list = await runCliExpectSuccess(["quotes", "list", "--json"]);
    const id = JSON.parse(list.stdout)[0].id;

    const result = await runCliExpectSuccess([
      "quotes",
      "update",
      id,
      "--expiration-date",
      "2026-12-31",
      "--yes",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data[0].id).toBe(id);
    // Per #313: the v2 spec types `expiresOn` as `date-time`, so the CLI
    // normalizes the user-friendly `YYYY-MM-DD` to ISO 8601 midnight-UTC
    // before sending. The returned quote reflects the normalized value.
    expect(data[0].expiresAt).toBe("2026-12-31T00:00:00Z");
  });

  it("pax8 quotes update fails when no fields are provided", async () => {
    const list = await runCliExpectSuccess(["quotes", "list", "--json"]);
    const id = JSON.parse(list.stdout)[0].id;

    const result = await runCliExpectFailure(["quotes", "update", id, "--yes"]);
    expect(result.stderr.toLowerCase()).toContain("update");
  });

  it("pax8 quotes delete with --yes returns deleted status", async () => {
    const list = await runCliExpectSuccess(["quotes", "list", "--json"]);
    const id = JSON.parse(list.stdout)[0].id;

    const result = await runCliExpectSuccess(["quotes", "delete", id, "--yes", "--json"]);
    const data = JSON.parse(result.stdout);
    expect(data[0].id).toBe(id);
    expect(data[0].status).toBe("Deleted");
  });
});
