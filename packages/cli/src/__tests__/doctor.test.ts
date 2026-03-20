import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("pax8 doctor", () => {
  it("runs diagnostics in demo mode", async () => {
    const result = await runCliExpectSuccess(["doctor"]);
    expect(result.stdout).toContain("Diagnostics");
    expect(result.stdout).toContain("Node.js version");
  });

  it("reports node version check as passing", async () => {
    const result = await runCliExpectSuccess(["doctor"]);
    // Node 20+ should pass
    expect(result.stdout).toMatch(/✓.*Node\.js version/);
  });

  it("reports auth configured in demo mode", async () => {
    const result = await runCliExpectSuccess(["doctor"]);
    expect(result.stdout).toMatch(/✓.*Authentication configured/);
    expect(result.stdout).toContain("Demo mode");
  });

  it("reports token fetch skipped in demo mode", async () => {
    const result = await runCliExpectSuccess(["doctor"]);
    expect(result.stdout).toMatch(/✓.*Token fetch/);
    expect(result.stdout).toContain("Skipped");
  });

  it("reports cache directory writable", async () => {
    const result = await runCliExpectSuccess(["doctor"]);
    expect(result.stdout).toMatch(/✓.*Cache directory writable/);
  });

  it("shows help text", async () => {
    const result = await runCliExpectSuccess(["doctor", "--help"]);
    expect(result.stdout).toContain("diagnostic");
    expect(result.stdout).toContain("Examples:");
  });
});
