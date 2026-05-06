// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCache } from "./cache.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("FileCache", () => {
  let cache: FileCache;
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = path.join(os.tmpdir(), `pax8-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    cache = new FileCache(cacheDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(cacheDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("should set and get a value", async () => {
    await cache.set("test-key", { foo: "bar" });
    const result = await cache.get<{ foo: string }>("test-key");
    expect(result).toEqual({ foo: "bar" });
  });

  it("should return null for missing key", async () => {
    const result = await cache.get("nonexistent");
    expect(result).toBeNull();
  });

  it("should return null for expired key", async () => {
    await cache.set("expiring", "value", 1); // 1ms TTL
    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = await cache.get("expiring");
    expect(result).toBeNull();
  });

  it("should return value within TTL", async () => {
    await cache.set("fresh", "value", 60000); // 60s TTL
    const result = await cache.get<string>("fresh");
    expect(result).toBe("value");
  });

  it("should persist without TTL (no expiry)", async () => {
    await cache.set("no-ttl", "forever");
    const result = await cache.get<string>("no-ttl");
    expect(result).toBe("forever");
  });

  it("should invalidate a key", async () => {
    await cache.set("to-remove", "value");
    await cache.invalidate("to-remove");
    const result = await cache.get("to-remove");
    expect(result).toBeNull();
  });

  it("should not throw when invalidating nonexistent key", async () => {
    await expect(cache.invalidate("nonexistent")).resolves.not.toThrow();
  });

  it("should clear all cached values", async () => {
    await cache.set("key1", "val1");
    await cache.set("key2", "val2");
    await cache.clear();
    expect(await cache.get("key1")).toBeNull();
    expect(await cache.get("key2")).toBeNull();
  });

  it("should not throw when clearing empty cache", async () => {
    await expect(cache.clear()).resolves.not.toThrow();
  });

  it("should overwrite existing key", async () => {
    await cache.set("key", "first");
    await cache.set("key", "second");
    const result = await cache.get<string>("key");
    expect(result).toBe("second");
  });

  it("should handle complex objects", async () => {
    const complex = { nested: { array: [1, 2, 3], bool: true }, str: "hello" };
    await cache.set("complex", complex);
    const result = await cache.get<typeof complex>("complex");
    expect(result).toEqual(complex);
  });
});
