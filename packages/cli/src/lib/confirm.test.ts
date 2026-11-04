// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Queue of answers the next `prompt()` call should hand back. Tests push
// onto this array in order. We can't `vi.spyOn(readline, "createInterface")`
// because the readline module namespace is non-configurable in ESM.
const answerQueue: string[] = [];

vi.mock("readline", () => ({
  createInterface: () => ({
    question: (_q: string, cb: (answer: string) => void) => {
      const next = answerQueue.shift() ?? "";
      cb(next);
    },
    close: () => {},
  }),
}));

import {
  confirm,
  confirmDestructive,
  confirmWithChange,
  isReplMode,
  replCmd,
} from "./confirm.js";

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

describe("confirmDestructive — keyword challenge is not bypassable", () => {
  // H-5: pre-fix, --yes / PAX8_YES short-circuited the keyword check
  // and returned true. That defeated the typed-keyword gate's whole
  // purpose for destructive ops. The tests below pin the new
  // contract: under --yes / PAX8_YES on a non-TTY stdin (CI, agent
  // subprocess, piped input), confirmDestructive refuses with a
  // stderr message and returns false. The keyword can still be
  // satisfied — but only interactively, by typing it.
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.PAX8_YES;
    process.argv = ["node", "test"];
    answerQueue.length = 0;
    // Default test env is non-TTY for stdin. Each test that needs the
    // interactive path overrides this locally.
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.argv = originalArgv;
    answerQueue.length = 0;
    stderrWrite.mockRestore();
  });

  it("PAX8_YES=1 does NOT bypass the keyword challenge — returns false on non-TTY stdin", async () => {
    process.env.PAX8_YES = "1";
    const result = await confirmDestructive("Delete?", "DELETE");
    expect(result).toBe(false);
    const written = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("Destructive operation requires");
    expect(written).toContain("DELETE");
  });

  it("--yes flag does NOT bypass the keyword challenge — returns false on non-TTY stdin", async () => {
    process.argv = ["node", "test", "--yes"];
    const result = await confirmDestructive("Delete?", "DELETE");
    expect(result).toBe(false);
    const written = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("Destructive operation requires");
  });

  it("non-TTY stdin without --yes still refuses (no auto-confirm path at all)", async () => {
    const result = await confirmDestructive("Delete?", "DELETE");
    expect(result).toBe(false);
  });

  it("on a TTY, --yes still prompts for the keyword — the user must type it", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    process.argv = ["node", "test", "--yes"];
    answerQueue.push("DELETE");
    const result = await confirmDestructive("Delete?", "DELETE");
    expect(result).toBe(true);
    // No stderr refusal — we reached the interactive prompt.
    const written = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
    expect(written).not.toContain("Destructive operation requires");
  });

  it("PAX8_CONFIRM_DESTRUCTIVE=<correct keyword> satisfies the gate without a TTY", async () => {
    process.env.PAX8_CONFIRM_DESTRUCTIVE = "DELETE";
    const result = await confirmDestructive("Delete?", "DELETE");
    expect(result).toBe(true);
    const written = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
    // No stderr refusal — the env override bypassed the no-TTY refusal.
    expect(written).not.toContain("Destructive operation requires");
  });

  it("PAX8_CONFIRM_DESTRUCTIVE=<wrong keyword> still refuses", async () => {
    process.env.PAX8_CONFIRM_DESTRUCTIVE = "WRONG_KEYWORD";
    const result = await confirmDestructive("Delete?", "DELETE");
    expect(result).toBe(false);
    // The mismatch is a silent "no" — the function returns false and
    // the caller treats it as "user declined." No stderr refusal here
    // (that's reserved for the no-TTY no-override case).
  });
});

describe("isReplMode and replCmd", () => {
  const originalRepl = process.env.PAX8_REPL;

  afterEach(() => {
    if (originalRepl === undefined) delete process.env.PAX8_REPL;
    else process.env.PAX8_REPL = originalRepl;
  });

  it("isReplMode is false when PAX8_REPL is unset", () => {
    delete process.env.PAX8_REPL;
    expect(isReplMode()).toBe(false);
  });

  it("isReplMode is true when PAX8_REPL=1", () => {
    process.env.PAX8_REPL = "1";
    expect(isReplMode()).toBe(true);
  });

  it("isReplMode is false for any non-1 value", () => {
    process.env.PAX8_REPL = "true";
    expect(isReplMode()).toBe(false);
    process.env.PAX8_REPL = "0";
    expect(isReplMode()).toBe(false);
  });

  it("replCmd strips the leading 'pax8 ' when in REPL mode", () => {
    process.env.PAX8_REPL = "1";
    expect(replCmd("pax8 auth login")).toBe("auth login");
    expect(replCmd("pax8 doctor")).toBe("doctor");
  });

  it("replCmd is a no-op when not in REPL mode", () => {
    delete process.env.PAX8_REPL;
    expect(replCmd("pax8 auth login")).toBe("pax8 auth login");
  });

  it("replCmd does not strip if string does not start with 'pax8 '", () => {
    process.env.PAX8_REPL = "1";
    expect(replCmd("auth login")).toBe("auth login");
    expect(replCmd("notpax8 thing")).toBe("notpax8 thing");
  });
});

describe("confirmWithChange", () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];

  beforeEach(() => {
    delete process.env.PAX8_YES;
    process.argv = ["node", "test"];
    answerQueue.length = 0;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.argv = originalArgv;
    answerQueue.length = 0;
  });

  it("returns the current value when PAX8_YES=1", async () => {
    process.env.PAX8_YES = "1";
    const result = await confirmWithChange("Confirm 5?", 5);
    expect(result).toBe(5);
  });

  it("returns the current value when --yes is set", async () => {
    process.argv = ["node", "test", "--yes"];
    const result = await confirmWithChange("Confirm 5?", 5);
    expect(result).toBe(5);
  });

  it("returns null when answered with 'n'", async () => {
    answerQueue.push("n");
    const result = await confirmWithChange("Confirm 5?", 5);
    expect(result).toBeNull();
  });

  it("returns the current value when answered with empty string", async () => {
    answerQueue.push("");
    const result = await confirmWithChange("Confirm 5?", 5);
    expect(result).toBe(5);
  });

  it("prompts for edit when 'e' picked, then accepts new value", async () => {
    // Three sequential prompts: 'e', '7', '' (empty re-confirm = accept).
    answerQueue.push("e", "7", "");
    const result = await confirmWithChange("Confirm 5?", 5);
    expect(result).toBe(7);
  });

  it("also accepts the full word 'edit' (back-compat shape with 'change')", async () => {
    answerQueue.push("edit", "9", "");
    const result = await confirmWithChange("Confirm 5?", 5);
    expect(result).toBe(9);
  });

  it("returns null when 'edit' answer is invalid", async () => {
    answerQueue.push("e", "not-a-number");
    const result = await confirmWithChange("Confirm 5?", 5);
    expect(result).toBeNull();
  });

  it("returns null when re-confirmation rejects the new value", async () => {
    answerQueue.push("e", "8", "n");
    const result = await confirmWithChange("Confirm 5?", 5);
    expect(result).toBeNull();
  });

  it("returns null when 'edit' answer is zero or negative", async () => {
    answerQueue.push("e", "0");
    const result = await confirmWithChange("Confirm 5?", 5);
    expect(result).toBeNull();
  });

  it("returns the existing value when 'edit' answer is empty", async () => {
    answerQueue.push("e", "");
    const result = await confirmWithChange("Confirm 5?", 5);
    expect(result).toBe(5);
  });

  // Regression: pre-fix `c` was the edit letter. After this PR `c` is
  // no longer recognized — treated as "neither yes nor edit" and
  // returns null (same disposition as `n`). Documents the clean break.
  it("treats the old 'c' letter as a rejection (no longer entering edit)", async () => {
    answerQueue.push("c");
    const result = await confirmWithChange("Confirm 5?", 5);
    expect(result).toBeNull();
  });
});

describe("confirm interactive prompt", () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];

  beforeEach(() => {
    delete process.env.PAX8_YES;
    process.argv = ["node", "test"];
    answerQueue.length = 0;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.argv = originalArgv;
    answerQueue.length = 0;
  });

  it("returns true on 'y' answer", async () => {
    answerQueue.push("y");
    expect(await confirm("Continue?")).toBe(true);
  });

  it("returns false on 'n' answer", async () => {
    answerQueue.push("n");
    expect(await confirm("Continue?")).toBe(false);
  });

  it("uses options.default true when answer is empty", async () => {
    answerQueue.push("");
    expect(await confirm("Continue?", { default: true })).toBe(true);
  });

  it("uses options.default false when answer is empty", async () => {
    answerQueue.push("");
    expect(await confirm("Continue?", { default: false })).toBe(false);
  });

  it("falls back to default=false when no options passed", async () => {
    answerQueue.push("");
    expect(await confirm("Continue?")).toBe(false);
  });
});

describe("confirmDestructive interactive prompt", () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];

  beforeEach(() => {
    delete process.env.PAX8_YES;
    process.argv = ["node", "test"];
    answerQueue.length = 0;
    // The interactive prompt path requires a TTY (H-5). Default test
    // env is non-TTY; opt in here.
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.argv = originalArgv;
    answerQueue.length = 0;
  });

  it("returns true only when the typed answer matches the keyword exactly", async () => {
    answerQueue.push("DELETE");
    expect(await confirmDestructive("Delete?", "DELETE")).toBe(true);
  });

  it("returns false on a case-mismatch", async () => {
    answerQueue.push("delete");
    expect(await confirmDestructive("Delete?", "DELETE")).toBe(false);
  });

  it("returns false on a different answer", async () => {
    answerQueue.push("yes");
    expect(await confirmDestructive("Delete?", "DELETE")).toBe(false);
  });
});
