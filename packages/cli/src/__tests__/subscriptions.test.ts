import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("pax8 subscriptions list", () => {
  it("lists subscriptions in demo mode", async () => {
    const result = await runCliExpectSuccess(["subscriptions", "list"]);
    // Non-TTY defaults to JSON
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("productName");
    expect(data[0]).toHaveProperty("quantity");
  });

  it("filters by company ID", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "list",
      "--company",
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    for (const sub of data) {
      expect(sub.companyId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    }
  });

  it("supports --json output", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "list",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]).toHaveProperty("status");
  });

  it("shows help text", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "list",
      "--help",
    ]);
    expect(result.stdout).toContain("List subscriptions");
    expect(result.stdout).toContain("--company");
    expect(result.stdout).toContain("Examples:");
  });
});

describe("pax8 subscriptions show", () => {
  it("shows subscription details", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "show",
      "sub-summit-m365bp-001",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data[0].id).toBe("sub-summit-m365bp-001");
    expect(data[0].productName).toBe("Microsoft 365 Business Premium [New Commerce Experience]");
  });

  it("shows subscription with --history", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "show",
      "sub-summit-m365bp-001",
      "--history",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data[0]).toHaveProperty("history");
    expect(Array.isArray(data[0].history)).toBe(true);
    expect(data[0].history.length).toBeGreaterThan(0);
    expect(data[0].history[0]).toHaveProperty("field");
  });

  it("shows help text", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "show",
      "--help",
    ]);
    expect(result.stdout).toContain("Show subscription details");
    expect(result.stdout).toContain("--history");
  });
});

describe("pax8 subscriptions renewals", () => {
  it("shows upcoming renewals", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("renewals");
    expect(data).toHaveProperty("nextActions");
    expect(Array.isArray(data.renewals)).toBe(true);
    expect(data.renewals.length).toBeGreaterThan(0);
    expect(data.renewals[0]).toHaveProperty("companyName");
    expect(data.renewals[0]).toHaveProperty("productName");
    expect(data.renewals[0]).toHaveProperty("daysUntilRenewal");
    expect(data.renewals[0]).toHaveProperty("renewalDate");
    // nextActions should suggest drilldowns
    expect(Array.isArray(data.nextActions)).toBe(true);
    if (data.nextActions.length > 0) {
      expect(data.nextActions[0]).toHaveProperty("command");
      expect(data.nextActions[0]).toHaveProperty("description");
    }
  });

  it("filters by --within 7d", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--within",
      "7d",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("renewals");
    expect(Array.isArray(data.renewals)).toBe(true);
    // All items should be within 7 days
    for (const item of data.renewals) {
      expect(item.daysUntilRenewal).toBeLessThanOrEqual(7);
    }
  });

  it("shows help text", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--help",
    ]);
    expect(result.stdout).toContain("upcoming subscription renewals");
    expect(result.stdout).toContain("--within");
    expect(result.stdout).toContain("Examples:");
  });
});

describe("pax8 subscriptions update", () => {
  it("shows help text", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "update",
      "--help",
    ]);
    expect(result.stdout).toContain("Update a subscription");
    expect(result.stdout).toContain("--quantity");
    expect(result.stdout).toContain("--billing-term");
  });

  it("warns when no changes specified", async () => {
    const result = await runCli([
      "subscriptions",
      "update",
      "sub-summit-m365bp-001",
    ]);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/[Nn]o changes/);
  });
});

describe("pax8 subscriptions cancel", () => {
  it("shows help text", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "cancel",
      "--help",
    ]);
    expect(result.stdout).toContain("Cancel a subscription");
  });

  it("errors with invalid subscription ID", async () => {
    const result = await runCliExpectFailure([
      "subscriptions",
      "cancel",
      "totally-bogus-id-not-real",
      "--yes",
    ]);
    const combined = result.stdout + result.stderr;
    expect(combined.length).toBeGreaterThan(0);
  });
});

describe("pax8 subscriptions", () => {
  it("shows help with subcommands", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "--help",
    ]);
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("show");
    expect(result.stdout).toContain("update");
    expect(result.stdout).toContain("cancel");
    expect(result.stdout).toContain("renewals");
  });
});
