// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  IDEMPOTENCY_TTL_MS,
  gc,
  hashArgs,
  isValidKey,
  loadEntry,
  saveEntry,
  type IdempotencyEntry,
} from "./idempotency.js";

describe("idempotency", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-idempotency-"));
    originalEnv = process.env.PAX8_IDEMPOTENCY_DIR;
    process.env.PAX8_IDEMPOTENCY_DIR = tmpDir;
  });

  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.PAX8_IDEMPOTENCY_DIR;
    else process.env.PAX8_IDEMPOTENCY_DIR = originalEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("isValidKey", () => {
    it("accepts UUID v4", () => {
      expect(isValidKey("9f3b2c1e-7d4f-4a8b-9c2d-1e2f3a4b5c6d")).toBe(true);
    });

    it("accepts 8+ char alphanumeric identifiers", () => {
      expect(isValidKey("abc12345")).toBe(true);
      expect(isValidKey("order_2026-04-30.001")).toBe(true);
    });

    it("rejects too-short keys", () => {
      expect(isValidKey("short")).toBe(false);
      expect(isValidKey("")).toBe(false);
    });

    it("rejects too-long keys", () => {
      expect(isValidKey("a".repeat(129))).toBe(false);
    });

    it("rejects invalid characters", () => {
      expect(isValidKey("has spaces hello")).toBe(false);
      expect(isValidKey("has/slashes/foo")).toBe(false);
      expect(isValidKey("has@symbols!yes")).toBe(false);
    });

    it("rejects non-string input", () => {
      // @ts-expect-error testing runtime validation
      expect(isValidKey(undefined)).toBe(false);
      // @ts-expect-error testing runtime validation
      expect(isValidKey(null)).toBe(false);
      // @ts-expect-error testing runtime validation
      expect(isValidKey(12345678)).toBe(false);
    });
  });

  describe("hashArgs", () => {
    it("is deterministic", () => {
      const a = hashArgs({ foo: "bar", n: 1 });
      const b = hashArgs({ foo: "bar", n: 1 });
      expect(a).toBe(b);
    });

    it("is order-independent", () => {
      const a = hashArgs({ a: 1, b: 2, c: 3 });
      const b = hashArgs({ c: 3, a: 1, b: 2 });
      expect(a).toBe(b);
    });

    it("differs when values differ", () => {
      const a = hashArgs({ qty: 5 });
      const b = hashArgs({ qty: 6 });
      expect(a).not.toBe(b);
    });

    it("ignores undefined values", () => {
      const a = hashArgs({ x: 1, y: undefined });
      const b = hashArgs({ x: 1 });
      expect(a).toBe(b);
    });

    it("normalizes nested objects (key order)", () => {
      const a = hashArgs({ obj: { a: 1, b: 2 } });
      const b = hashArgs({ obj: { b: 2, a: 1 } });
      expect(a).toBe(b);
    });
  });

  describe("save / load", () => {
    it("returns null when no entry exists", async () => {
      expect(await loadEntry("orders.create", "abc12345")).toBeNull();
    });

    it("round-trips an entry", async () => {
      const entry: IdempotencyEntry = {
        key: "abc12345",
        command: "orders.create",
        argsHash: "deadbeef",
        output: "hello\n",
        exitCode: 0,
        createdAt: new Date().toISOString(),
      };
      await saveEntry(entry);
      const loaded = await loadEntry("orders.create", "abc12345");
      expect(loaded).toEqual(entry);
    });

    it("isolates entries by command", async () => {
      const baseEntry = {
        key: "abc12345",
        argsHash: "h1",
        output: "x",
        exitCode: 0,
        createdAt: new Date().toISOString(),
      };
      await saveEntry({ ...baseEntry, command: "orders.create" });
      await saveEntry({ ...baseEntry, command: "subscriptions.update" });
      const a = await loadEntry("orders.create", "abc12345");
      const b = await loadEntry("subscriptions.update", "abc12345");
      expect(a?.command).toBe("orders.create");
      expect(b?.command).toBe("subscriptions.update");
    });
  });

  describe("garbage collection", () => {
    it("evicts entries older than 24h", async () => {
      const old = new Date(Date.now() - IDEMPOTENCY_TTL_MS - 60_000).toISOString();
      const fresh = new Date().toISOString();

      await saveEntry({
        key: "oldkey12",
        command: "orders.create",
        argsHash: "h",
        output: "stale",
        exitCode: 0,
        createdAt: old,
      });
      await saveEntry({
        key: "freshkey",
        command: "orders.create",
        argsHash: "h",
        output: "fresh",
        exitCode: 0,
        createdAt: fresh,
      });

      // gc is invoked implicitly by loadEntry, but we also call it directly.
      await gc();

      expect(await loadEntry("orders.create", "oldkey12")).toBeNull();
      expect(await loadEntry("orders.create", "freshkey")).not.toBeNull();
    });

    it("loadEntry refuses to return a stale entry", async () => {
      const old = new Date(Date.now() - IDEMPOTENCY_TTL_MS - 1_000).toISOString();
      await saveEntry({
        key: "stalekey",
        command: "orders.create",
        argsHash: "h",
        output: "x",
        exitCode: 0,
        createdAt: old,
      });
      // Even before background gc, loadEntry filters based on createdAt.
      expect(await loadEntry("orders.create", "stalekey")).toBeNull();
    });

    it("removes corrupt files", async () => {
      const dir = process.env.PAX8_IDEMPOTENCY_DIR!;
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "garbage.json"), "{ not json");
      await gc();
      const remaining = await fs.readdir(dir);
      expect(remaining.filter((f) => f.endsWith(".json"))).toHaveLength(0);
    });

    it("does not throw when the dir does not exist", async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await expect(gc()).resolves.toBeUndefined();
    });
  });
});
