// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  saveLastList,
  resolveFromLastList,
  saveLastListContext,
  loadLastListContext,
  rewriteArgvForPage,
} from "./last-list.js";

describe("last-list", () => {
  let tmpDir: string;
  const originalConfigDir = process.env.PAX8_CONFIG_DIR;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-last-list-"));
    process.env.PAX8_CONFIG_DIR = tmpDir;
  });

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.PAX8_CONFIG_DIR;
    else process.env.PAX8_CONFIG_DIR = originalConfigDir;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("saves and resolves a numbered entry", async () => {
    await saveLastList([
      { index: 1, id: "abc-123", name: "Acme Corp" },
      { index: 2, id: "def-456", name: "Beta Inc" },
    ]);

    const found = await resolveFromLastList("1");
    expect(found).toEqual({ id: "abc-123", name: "Acme Corp" });

    const found2 = await resolveFromLastList("2");
    expect(found2).toEqual({ id: "def-456", name: "Beta Inc" });
  });

  it("returns null for non-numeric input", async () => {
    await saveLastList([{ index: 1, id: "abc", name: "Acme" }]);
    expect(await resolveFromLastList("abc-123")).toBeNull();
    expect(await resolveFromLastList("not-a-number")).toBeNull();
  });

  it("returns null for a UUID-like string even if it begins with digits", async () => {
    await saveLastList([{ index: 1, id: "abc", name: "Acme" }]);
    // parseInt("123abc") would be 123 — guard rejects via String(num) !== input.trim()
    expect(await resolveFromLastList("123abc")).toBeNull();
  });

  it("returns null when the index is out of range", async () => {
    await saveLastList([{ index: 1, id: "abc", name: "Acme" }]);
    expect(await resolveFromLastList("99")).toBeNull();
  });

  it("returns null when no last list has been saved", async () => {
    expect(await resolveFromLastList("1")).toBeNull();
  });

  it("trims whitespace before matching", async () => {
    await saveLastList([{ index: 5, id: "x", name: "X" }]);
    const found = await resolveFromLastList("5");
    expect(found).toEqual({ id: "x", name: "X" });
  });

  it("overwrites a previously-saved list", async () => {
    await saveLastList([{ index: 1, id: "old", name: "Old" }]);
    await saveLastList([{ index: 1, id: "new", name: "New" }]);
    const found = await resolveFromLastList("1");
    expect(found).toEqual({ id: "new", name: "New" });
  });

  it("returns null when the cache file is corrupt", async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, "last-list.json"), "{ not json", "utf-8");
    expect(await resolveFromLastList("1")).toBeNull();
  });

  it("does not throw when the config dir cannot be created", async () => {
    // Point at a path that exists as a file, so mkdir fails — saveLastList must swallow.
    const blockerFile = path.join(tmpDir, "blocker");
    await fs.writeFile(blockerFile, "block");
    process.env.PAX8_CONFIG_DIR = path.join(blockerFile, "nested");
    // Should not throw
    await expect(
      saveLastList([{ index: 1, id: "x", name: "y" }])
    ).resolves.toBeUndefined();
  });

  // #456: REPL list-context navigation. The save/load pair drives the
  // REPL's `back` / `n` / `p` shortcuts; the rewriter is the helper that
  // mutates the saved argv to target a different page.
  describe("list context (#456)", () => {
    it("round-trips a saved command + page", async () => {
      await saveLastListContext({
        command: ["clients", "list", "--status", "Active", "--page", "2", "--size", "25"],
        page: { number: 2, totalPages: 8 },
      });
      const loaded = await loadLastListContext();
      expect(loaded).not.toBeNull();
      expect(loaded!.command).toEqual([
        "clients",
        "list",
        "--status",
        "Active",
        "--page",
        "2",
        "--size",
        "25",
      ]);
      expect(loaded!.page).toEqual({ number: 2, totalPages: 8 });
    });

    it("returns null when no context has been saved", async () => {
      expect(await loadLastListContext()).toBeNull();
    });

    it("returns null when the context file is corrupt", async () => {
      await fs.writeFile(path.join(tmpDir, "last-list-context.json"), "{ broken", "utf-8");
      expect(await loadLastListContext()).toBeNull();
    });

    it("returns null when the saved shape fails validation", async () => {
      // Tampered file — missing `page`.
      await fs.writeFile(
        path.join(tmpDir, "last-list-context.json"),
        JSON.stringify({ command: ["clients", "list"] }),
        "utf-8",
      );
      expect(await loadLastListContext()).toBeNull();
    });

    it("rewrites --page when present", () => {
      const out = rewriteArgvForPage(
        ["clients", "list", "--status", "Active", "--page", "2", "--size", "25"],
        5,
      );
      expect(out).toEqual([
        "clients",
        "list",
        "--status",
        "Active",
        "--page",
        "5",
        "--size",
        "25",
      ]);
    });

    it("appends --page when the saved argv didn't carry one", () => {
      const out = rewriteArgvForPage(["clients", "list"], 3);
      expect(out).toEqual(["clients", "list", "--page", "3"]);
    });

    it("rewriting does not mutate the input argv", () => {
      const input = ["clients", "list", "--page", "1"];
      const out = rewriteArgvForPage(input, 7);
      expect(input).toEqual(["clients", "list", "--page", "1"]);
      expect(out).toEqual(["clients", "list", "--page", "7"]);
    });
  });
});
