// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the prompts module before importing our wrapper so vi.mock hoisting works.
vi.mock("prompts", () => ({
  default: vi.fn(),
}));

import promptsMod from "prompts";
import { ask } from "./prompts.js";

const mockPrompts = vi.mocked(promptsMod);

describe("ask()", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockPrompts.mockReset();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("returns answers from prompts when not cancelled", async () => {
    mockPrompts.mockResolvedValue({ name: "alice" });

    const result = await ask({ type: "text", name: "name", message: "Name?" });

    expect(result).toEqual({ name: "alice" });
  });

  it("calls process.exit(130) when onCancel fires", async () => {
    // Simulate prompts calling onCancel by capturing it and invoking it.
    mockPrompts.mockImplementation(
      (_questions: unknown, opts: { onCancel?: () => void } | undefined) => {
        opts?.onCancel?.();
        return Promise.resolve({});
      },
    );

    await ask({ type: "text", name: "name", message: "Name?" });

    expect(exitSpy).toHaveBeenCalledWith(130);
  });

  it("writes a newline to stderr before exiting on cancel", async () => {
    mockPrompts.mockImplementation(
      (_questions: unknown, opts: { onCancel?: () => void } | undefined) => {
        opts?.onCancel?.();
        return Promise.resolve({});
      },
    );

    await ask({ type: "text", name: "name", message: "Name?" });

    expect(stderrSpy).toHaveBeenCalledWith("\n");
    expect(exitSpy).toHaveBeenCalledWith(130);
  });

  it("passes an array of questions through unchanged", async () => {
    mockPrompts.mockResolvedValue({ a: "1", b: "2" });

    const questions = [
      { type: "text" as const, name: "a", message: "A?" },
      { type: "text" as const, name: "b", message: "B?" },
    ];
    const result = await ask(questions);

    expect(mockPrompts).toHaveBeenCalledWith(questions, expect.any(Object));
    expect(result).toEqual({ a: "1", b: "2" });
  });

  it("always passes an onCancel option to prompts", async () => {
    mockPrompts.mockResolvedValue({});

    await ask({ type: "text", name: "x", message: "X?" });

    expect(mockPrompts).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ onCancel: expect.any(Function) }),
    );
  });
});
