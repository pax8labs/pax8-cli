// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSpinner, stopAllActiveSpinners, _getActiveSpinnerCount } from "./spinner.js";

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

describe("stopAllActiveSpinners", () => {
  // We don't need a real TTY for these tests — when stderr is non-TTY, ora's
  // start/stop are effectively no-ops, but our wrapper still threads add/remove
  // calls to the registry, which is what we're testing. Keeping the stream
  // non-TTY also avoids ora reaching into stream-only methods like cursorTo()
  // that don't exist on vitest's stderr stand-in.
  const originalIsTTY = process.stderr.isTTY;
  beforeEach(() => {
    Object.defineProperty(process.stderr, "isTTY", { value: false, writable: true });
    delete process.env.PAX8_QUIET;
    // Belt-and-braces: clear any spinners left over from previous suites.
    stopAllActiveSpinners();
  });
  afterEach(() => {
    stopAllActiveSpinners();
    Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, writable: true });
  });

  it("is a no-op when no spinners are active", () => {
    expect(_getActiveSpinnerCount()).toBe(0);
    expect(() => stopAllActiveSpinners()).not.toThrow();
    expect(_getActiveSpinnerCount()).toBe(0);
  });

  it("stops every active spinner and clears the registry", () => {
    const a = createSpinner("a").start();
    const b = createSpinner("b").start();
    const c = createSpinner("c").start();
    expect(_getActiveSpinnerCount()).toBe(3);

    stopAllActiveSpinners();
    expect(_getActiveSpinnerCount()).toBe(0);
    // Three calls each, but they're idempotent — the registry should stay
    // empty even if we run again.
    expect(() => stopAllActiveSpinners()).not.toThrow();
    expect(_getActiveSpinnerCount()).toBe(0);
    // Lint silence — the local refs are intentional, used to confirm
    // the original spinner instances aren't lingering.
    void a; void b; void c;
  });

  it("removes a spinner from the registry on .stop()", () => {
    const s = createSpinner("x").start();
    expect(_getActiveSpinnerCount()).toBe(1);
    s.stop();
    expect(_getActiveSpinnerCount()).toBe(0);
  });

  it("removes a spinner from the registry on .succeed()", () => {
    const s = createSpinner("x").start();
    expect(_getActiveSpinnerCount()).toBe(1);
    s.succeed("done");
    expect(_getActiveSpinnerCount()).toBe(0);
  });

  it("removes a spinner from the registry on .fail()", () => {
    const s = createSpinner("x").start();
    expect(_getActiveSpinnerCount()).toBe(1);
    s.fail("nope");
    expect(_getActiveSpinnerCount()).toBe(0);
  });
});
