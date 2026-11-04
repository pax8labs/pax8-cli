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
const spawnedCommands: Array<{ cmd: string; args: string[] }> = [];
vi.mock("child_process", async (importActual) => {
  const actual = await importActual<typeof import("child_process")>();
  return {
    ...actual,
    spawn: (cmd: string, args: string[]) => {
      spawnedCommands.push({ cmd, args });
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

  it("renders one concise drill-in hint with a sample, not a per-row block", async () => {
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
    // The hint should reference the range and the first row's label / key as
    // a sample, but not enumerate every row.
    expect(written).toContain("Type 1-2");
    expect(written).toContain("1");
    expect(written).toContain("List subscriptions");
    // The second row's label should NOT be printed (the table itself is the menu).
    expect(written).not.toContain("Show renewals");
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

  it("spawns the picked step's command via the active CLI entrypoint (#457)", async () => {
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
    // #457: drill-in launches `node <cliPath> <args>` instead of `pax8 <args>`,
    // so a CLI launched without `pax8` on PATH still drills in correctly.
    // First element after the cliPath is the resource; the rest are the
    // command's args verbatim.
    expect(spawnedCommands[0].cmd).toBe("node");
    const [cliPath, ...args] = spawnedCommands[0].args;
    expect(typeof cliPath).toBe("string");
    expect(cliPath.length).toBeGreaterThan(0);
    expect(args).toEqual(["subscriptions", "list"]);
  });
});
