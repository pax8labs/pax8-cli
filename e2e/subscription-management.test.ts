import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("E2E: Subscription management — daily workflows", () => {
  it("pax8 subscriptions list shows subscriptions", async () => {
    const result = await runCliExpectSuccess(["subscriptions", "list"]);
    expect(result.stdout.length).toBeGreaterThan(0);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("pax8 subscriptions list --json produces valid JSON", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "list",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("productName");
    expect(data[0]).toHaveProperty("status");
    expect(data[0]).toHaveProperty("quantity");
  });

  it("pax8 subscriptions renewals shows renewal report", async () => {
    const result = await runCliExpectSuccess(["subscriptions", "renewals"]);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("pax8 subscriptions renewals --within 7d shows filtered renewals", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--within",
      "7d",
    ]);
    // Should succeed even if no renewals within 7 days
    expect(result.exitCode).toBe(0);
  });

  it("pax8 subscriptions renewals --json returns a flat array by default", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    if (data.length > 0) {
      expect(data[0]).toHaveProperty("subscriptionId");
      expect(data[0]).toHaveProperty("renewalDate");
      expect(data[0]).toHaveProperty("mrrAtRisk");
      expect(data[0]).toHaveProperty("daysUntilRenewal");
    }
  });

  it("pax8 subscriptions renewals --json --with-actions wraps in { renewals, nextActions }", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--json",
      "--with-actions",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("renewals");
    expect(data).toHaveProperty("nextActions");
    expect(Array.isArray(data.renewals)).toBe(true);
    expect(Array.isArray(data.nextActions)).toBe(true);
  });
});
