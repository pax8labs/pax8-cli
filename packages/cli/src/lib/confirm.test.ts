import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { confirm, confirmDestructive } from "./confirm.js";

describe("confirm", () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];

  beforeEach(() => {
    delete process.env.PAX8_YES;
    process.argv = ["node", "test"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.argv = originalArgv;
  });

  it("returns true when PAX8_YES=1", async () => {
    process.env.PAX8_YES = "1";
    const result = await confirm("Continue?");
    expect(result).toBe(true);
  });

  it("returns true when --yes flag is present", async () => {
    process.argv = ["node", "test", "--yes"];
    const result = await confirm("Continue?");
    expect(result).toBe(true);
  });

  it("returns true when -y flag is present", async () => {
    process.argv = ["node", "test", "-y"];
    const result = await confirm("Continue?");
    expect(result).toBe(true);
  });
});

describe("confirmDestructive", () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];

  beforeEach(() => {
    delete process.env.PAX8_YES;
    process.argv = ["node", "test"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.argv = originalArgv;
  });

  it("returns true when PAX8_YES=1", async () => {
    process.env.PAX8_YES = "1";
    const result = await confirmDestructive("Delete?", "DELETE");
    expect(result).toBe(true);
  });

  it("returns true when --yes flag is present", async () => {
    process.argv = ["node", "test", "--yes"];
    const result = await confirmDestructive("Delete?", "DELETE");
    expect(result).toBe(true);
  });
});
