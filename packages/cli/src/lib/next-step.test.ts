// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const answerQueue: string[] = [];

vi.mock("readline", () => ({
  createInterface: () => ({
    question: (_q: string, cb: (a: string) => void) => {
      cb(answerQueue.shift() ?? "");
    },
    close: () => {},
  }),
}));

// Mock spawn so we don't actually launch a child process in tests where
// the user "selects" a step.
const spawnedCommands: Array<{ args: string[] }> = [];
vi.mock("child_process", async (importActual) => {
  const actual = await importActual<typeof import("child_process")>();
  return {
    ...actual,
    spawn: (_cmd: string, args: string[]) => {
      spawnedCommands.push({ args });
      const handlers: Record<string, () => void> = {};
      // Synchronously invoke the close handler on next tick.
      const obj = {
        on: (event: string, cb: () => void) => {
          handlers[event] = cb;
          if (event === "close") {
            // schedule close in a microtask
            queueMicrotask(() => cb());
          }
          return obj;
        },
      };
      return obj;
    },
  };
});

import { promptNextSteps, type NextStep } from "./next-step.js";

describe("promptNextSteps", () => {
  const originalIsTTY = process.stdin.isTTY;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    answerQueue.length = 0;
    spawnedCommands.length = 0;
    stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrWrite.mockRestore();
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
  });

  it("returns silently when stdin is not a TTY (piped invocation)", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      writable: true,
      configurable: true,
    });

    const steps: NextStep[] = [
      { key: "1", label: "List subscriptions", command: ["subscriptions", "list"] },
    ];
    await promptNextSteps(steps);
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(spawnedCommands).toHaveLength(0);
  });

  it("returns silently when there are no steps to suggest", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });

    await promptNextSteps([]);
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(spawnedCommands).toHaveLength(0);
  });

  it("renders each step's key, label, and command preview to stderr", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });
    answerQueue.push(""); // user just hits Enter

    const steps: NextStep[] = [
      { key: "1", label: "List subscriptions", command: ["subscriptions", "list"] },
      { key: "2", label: "Show renewals", command: ["subscriptions", "renewals"] },
    ];

    await promptNextSteps(steps);

    const written = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("[1]");
    expect(written).toContain("List subscriptions");
    expect(written).toContain("subscriptions list");
    expect(written).toContain("[2]");
    expect(written).toContain("Show renewals");
    expect(written).toContain("subscriptions renewals");
    // No spawn since user skipped.
    expect(spawnedCommands).toHaveLength(0);
  });

  it("returns without spawning when the user picks an unknown key", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });
    answerQueue.push("99");

    const steps: NextStep[] = [
      { key: "1", label: "x", command: ["a"] },
    ];
    await promptNextSteps(steps);
    expect(spawnedCommands).toHaveLength(0);
  });

  it("returns without spawning when the user just hits Enter", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });
    answerQueue.push("   "); // whitespace-only -> trim() empty -> skip

    const steps: NextStep[] = [
      { key: "1", label: "x", command: ["a"] },
    ];
    await promptNextSteps(steps);
    expect(spawnedCommands).toHaveLength(0);
  });

  it("spawns the picked step's command when the user enters a valid key", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });
    answerQueue.push("1");

    const steps: NextStep[] = [
      { key: "1", label: "List subs", command: ["subscriptions", "list"] },
      { key: "2", label: "Renewals", command: ["subscriptions", "renewals"] },
    ];

    await promptNextSteps(steps);

    expect(spawnedCommands).toHaveLength(1);
    expect(spawnedCommands[0].args).toEqual(["subscriptions", "list"]);
  });
});
