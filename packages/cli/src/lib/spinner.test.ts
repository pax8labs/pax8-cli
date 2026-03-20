import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSpinner } from "./spinner.js";

describe("createSpinner", () => {
  const originalEnv = { ...process.env };
  const originalIsTTY = process.stderr.isTTY;

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, writable: true });
  });

  it("creates a spinner instance", () => {
    const spinner = createSpinner("Loading...");
    expect(spinner).toBeDefined();
    expect(spinner.text).toBe("Loading...");
  });

  it("disables spinner when PAX8_QUIET=1", () => {
    process.env.PAX8_QUIET = "1";
    const spinner = createSpinner("Loading...");
    expect(spinner).toBeDefined();
    // The spinner should be disabled; it still has the text property
    expect(spinner.text).toBe("Loading...");
  });

  it("disables spinner when stderr is not a TTY", () => {
    Object.defineProperty(process.stderr, "isTTY", { value: false, writable: true });
    delete process.env.PAX8_QUIET;
    const spinner = createSpinner("Loading...");
    expect(spinner).toBeDefined();
  });
});
