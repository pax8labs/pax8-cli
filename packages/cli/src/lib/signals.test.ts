// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  installSigintHandler,
  markWriteInFlight,
  _getWriteInFlight,
  _resetWriteInFlight,
} from "./signals.js";

describe("markWriteInFlight", () => {
  beforeEach(() => {
    _resetWriteInFlight();
  });

  it("registers an in-flight write", () => {
    expect(_getWriteInFlight()).toBeNull();
    markWriteInFlight("orders");
    expect(_getWriteInFlight()).toEqual({ resource: "orders", hint: undefined });
  });

  it("clears the registry when done() is called", () => {
    const done = markWriteInFlight("orders");
    expect(_getWriteInFlight()).not.toBeNull();
    done();
    expect(_getWriteInFlight()).toBeNull();
  });

  it("the latest call wins; an older done() does not clear a newer entry", () => {
    const doneA = markWriteInFlight("orders");
    const doneB = markWriteInFlight("subscriptions");
    expect(_getWriteInFlight()?.resource).toBe("subscriptions");
    // The first done() should be a no-op now that B is the active write.
    doneA();
    expect(_getWriteInFlight()?.resource).toBe("subscriptions");
    doneB();
    expect(_getWriteInFlight()).toBeNull();
  });

  it("preserves the optional hint", () => {
    markWriteInFlight("orders", "id=abc");
    expect(_getWriteInFlight()).toEqual({
      resource: "orders",
      hint: "id=abc",
      idempotencyKey: undefined,
    });
  });

  it("preserves the optional idempotency key", () => {
    markWriteInFlight("orders", undefined, "9f3b2c1e-7d4f-4a8b-9c2d-1e2f3a4b5c6d");
    expect(_getWriteInFlight()).toEqual({
      resource: "orders",
      hint: undefined,
      idempotencyKey: "9f3b2c1e-7d4f-4a8b-9c2d-1e2f3a4b5c6d",
    });
  });
});

describe("installSigintHandler — capture and invoke", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;
  let sigintHandler: ((...args: unknown[]) => void) | null = null;
  let onSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    sigintHandler = null;
    _resetWriteInFlight();

    // Force the module to re-run by resetting the module registry. After this,
    // the next `import("./signals.js")` will execute the file fresh — meaning
    // the `handlerInstalled` flag is reset to false and `installSigintHandler`
    // will actually wire a fresh listener via the spied `process.on`.
    vi.resetModules();

    onSpy = vi
      .spyOn(process, "on")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock signature
      .mockImplementation((event: string | symbol, listener: any) => {
        if (event === "SIGINT") {
          sigintHandler = listener;
        }
        return process;
      });

    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const fresh = await import("./signals.js");
    fresh._resetWriteInFlight();
    fresh.installSigintHandler();
  });

  afterEach(() => {
    onSpy.mockRestore();
    exitSpy.mockRestore();
    stderrWrite.mockRestore();
  });

  it("captures exactly one SIGINT handler on first install", () => {
    expect(sigintHandler).not.toBeNull();
  });

  // The first-SIGINT path now awaits a bounded telemetry flush before
  // exiting (#145), so `process.exit(130)` lands on a microtask rather
  // than synchronously. Tests yield with an explicit microtask hop.
  const settle = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  it("on first SIGINT exits with code 130", async () => {
    expect(sigintHandler).not.toBeNull();
    sigintHandler!();
    await settle();
    expect(exitSpy).toHaveBeenCalledWith(130);
  });

  it("on second SIGINT also exits with 130 (Node default takes over)", async () => {
    expect(sigintHandler).not.toBeNull();
    sigintHandler!();
    sigintHandler!();
    await settle();
    expect(exitSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenLastCalledWith(130);
  });

  it("on first SIGINT with an in-flight write writes a (cancelled) hint to stderr", async () => {
    expect(sigintHandler).not.toBeNull();
    const fresh = await import("./signals.js");
    fresh.markWriteInFlight("orders", "(idempotency-key=xyz)");

    sigintHandler!();
    await settle();

    const written = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("(cancelled)");
    expect(written).toContain("orders");
    expect(written).toContain("idempotency-key=xyz");
    expect(exitSpy).toHaveBeenCalledWith(130);
  });

  it("on first SIGINT with an idempotency key includes a Retry hint", async () => {
    expect(sigintHandler).not.toBeNull();
    const fresh = await import("./signals.js");
    fresh.markWriteInFlight(
      "orders",
      undefined,
      "9f3b2c1e-7d4f-4a8b-9c2d-1e2f3a4b5c6d",
    );

    sigintHandler!();
    await settle();

    const written = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("(cancelled)");
    expect(written).toContain("Retry with: --idempotency-key");
    expect(written).toContain("9f3b2c1e-7d4f-4a8b-9c2d-1e2f3a4b5c6d");
    expect(exitSpy).toHaveBeenCalledWith(130);
  });

  it("on first SIGINT without an idempotency key skips the Retry hint", async () => {
    expect(sigintHandler).not.toBeNull();
    const fresh = await import("./signals.js");
    fresh.markWriteInFlight("orders");

    sigintHandler!();
    await settle();

    const written = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("(cancelled)");
    expect(written).not.toContain("Retry with: --idempotency-key");
    expect(exitSpy).toHaveBeenCalledWith(130);
  });

  it("on first SIGINT without an in-flight write skips the (cancelled) hint", async () => {
    expect(sigintHandler).not.toBeNull();
    sigintHandler!();
    await settle();
    const written = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
    expect(written).not.toContain("(cancelled)");
    expect(exitSpy).toHaveBeenCalledWith(130);
  });
});

describe("installSigintHandler — idempotent", () => {
  beforeEach(() => {
    _resetWriteInFlight();
  });

  it("calling installSigintHandler() twice does not register a second listener", async () => {
    vi.resetModules();
    const calls: string[] = [];
    const onSpy = vi
      .spyOn(process, "on")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock signature
      .mockImplementation((event: string | symbol, _listener: any) => {
        calls.push(String(event));
        return process;
      });

    try {
      const fresh = await import("./signals.js");
      fresh.installSigintHandler();
      fresh.installSigintHandler();
      fresh.installSigintHandler();

      const sigintCount = calls.filter((c) => c === "SIGINT").length;
      expect(sigintCount).toBe(1);
    } finally {
      onSpy.mockRestore();
    }
  });
});

// installSigintHandler is exported but the import alone shouldn't trigger it.
describe("installSigintHandler — exported", () => {
  it("is a function", () => {
    expect(typeof installSigintHandler).toBe("function");
  });
});
