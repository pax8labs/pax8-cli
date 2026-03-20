import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

describe("E2E: Onboarding — first-time user experience", () => {
  it("pax8 doctor reports checks (Node version, config, etc.)", async () => {
    const result = await runCliExpectSuccess(["doctor"]);
    expect(result.stdout).toContain("Node.js version");
    expect(result.stdout).toContain("Diagnostics");
  });

  it("pax8 auth login --client-id demo --client-secret demo succeeds in demo mode", async () => {
    const result = await runCliExpectSuccess([
      "auth",
      "login",
      "--client-id",
      "demo",
      "--client-secret",
      "demo",
    ]);
    expect(result.stdout).toContain("Authenticated");
    expect(result.stdout).toContain("demo mode");
  });

  it("pax8 auth status shows auth info", async () => {
    const result = await runCliExpectSuccess(["auth", "status"]);
    expect(result.stdout).toContain("Authenticated");
    expect(result.stdout).toContain("Demo");
  });

  it("pax8 companies list shows demo companies", async () => {
    const result = await runCliExpectSuccess(["companies", "list"]);
    // In non-TTY, default output is JSON
    expect(result.stdout.length).toBeGreaterThan(0);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("name");
  });

  it("pax8 companies list --json produces valid JSON array", async () => {
    const result = await runCliExpectSuccess(["companies", "list", "--json"]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("name");
    expect(data[0]).toHaveProperty("status");
  });
});
