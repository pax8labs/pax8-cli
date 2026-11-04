// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { TokenCacheStore, computeCacheIdentity } from "./token-cache-store.js";

const CLIENT_ID = "test-client-id";
const API_BASE = "https://api.pax8.com/v1";

describe("TokenCacheStore (#233)", () => {
  let dir: string;
  const originalConfigDir = process.env.PAX8_CONFIG_DIR;

  beforeEach(() => {
    // Use a homedir-anchored tmpdir so `validateConfigDir` accepts it
    // without the PAX8_ALLOW_NON_HOME_CONFIG opt-in (matches production
    // and the credential-store test pattern).
    dir = mkdtempSync(path.join(os.homedir(), ".pax8-tokencache-test-"));
    process.env.PAX8_CONFIG_DIR = dir;
  });

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.PAX8_CONFIG_DIR;
    else process.env.PAX8_CONFIG_DIR = originalConfigDir;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  });

  it("round-trips a saved entry", async () => {
    const store = new TokenCacheStore();
    const id = computeCacheIdentity({ clientId: CLIENT_ID, apiBaseUrl: API_BASE });
    const entry = {
      accessToken: "tok",
      expiresAt: Date.now() + 60_000,
      ttlMs: 86_400_000,
      ...id,
    };

    await store.save(entry);
    const loaded = store.load({ clientId: CLIENT_ID, apiBaseUrl: API_BASE });
    expect(loaded).toEqual(entry);
  });

  it("writes the cache file at <configDir>/.token-cache.json with mode 0o600", async () => {
    // Pin the file path + permissions. The path is part of the public
    // contract (`pax8 doctor` surfaces the same path) and 0o600 is the
    // confidentiality guarantee — both must not drift unintentionally.
    const store = new TokenCacheStore();
    const id = computeCacheIdentity({ clientId: CLIENT_ID, apiBaseUrl: API_BASE });
    await store.save({
      accessToken: "tok",
      expiresAt: Date.now() + 60_000,
      ttlMs: 86_400_000,
      ...id,
    });

    const expected = path.join(dir, ".token-cache.json");
    expect(TokenCacheStore.cacheFilePath).toBe(expected);
    const stat = statSync(expected);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("returns null when the cache file is missing", () => {
    const store = new TokenCacheStore();
    expect(store.load({ clientId: CLIENT_ID, apiBaseUrl: API_BASE })).toBeNull();
  });

  it("returns null on a clientIdHash mismatch (credential rotation)", async () => {
    const store = new TokenCacheStore();
    const id = computeCacheIdentity({ clientId: CLIENT_ID, apiBaseUrl: API_BASE });
    await store.save({
      accessToken: "tok",
      expiresAt: Date.now() + 60_000,
      ttlMs: 86_400_000,
      ...id,
    });

    // Read back under a different clientId — must be null.
    expect(store.load({ clientId: "rotated-client", apiBaseUrl: API_BASE })).toBeNull();
  });

  it("returns null on an apiBaseHash mismatch (prod↔staging switch)", async () => {
    const store = new TokenCacheStore();
    const id = computeCacheIdentity({ clientId: CLIENT_ID, apiBaseUrl: API_BASE });
    await store.save({
      accessToken: "tok",
      expiresAt: Date.now() + 60_000,
      ttlMs: 86_400_000,
      ...id,
    });

    expect(
      store.load({ clientId: CLIENT_ID, apiBaseUrl: "https://api-staging.pax8.com/v1" }),
    ).toBeNull();
  });

  it("normalizes trailing slashes on the API base URL when hashing", async () => {
    // The TokenManager always passes the trailing-slash-stripped form;
    // pin that the hash helper agrees so a future caller passing the
    // raw env var doesn't blow up the round-trip.
    const a = computeCacheIdentity({ clientId: CLIENT_ID, apiBaseUrl: "https://api.pax8.com/v1" });
    const b = computeCacheIdentity({ clientId: CLIENT_ID, apiBaseUrl: "https://api.pax8.com/v1/" });
    const c = computeCacheIdentity({
      clientId: CLIENT_ID,
      apiBaseUrl: "https://api.pax8.com/v1///",
    });
    expect(a.apiBaseHash).toBe(b.apiBaseHash);
    expect(a.apiBaseHash).toBe(c.apiBaseHash);
  });

  it("does not store the raw clientId or apiBase on disk", async () => {
    const store = new TokenCacheStore();
    const id = computeCacheIdentity({ clientId: CLIENT_ID, apiBaseUrl: API_BASE });
    await store.save({
      accessToken: "tok",
      expiresAt: Date.now() + 60_000,
      ttlMs: 86_400_000,
      ...id,
    });

    const raw = readFileSync(path.join(dir, ".token-cache.json"), "utf-8");
    expect(raw).not.toContain(CLIENT_ID);
    expect(raw).not.toContain(API_BASE);
    // The hash itself MUST be present, of course.
    expect(raw).toContain(id.clientIdHash);
  });

  it("returns null on a corrupt JSON file (treated as cache miss)", () => {
    writeFileSync(path.join(dir, ".token-cache.json"), "not json{", { mode: 0o600 });
    const store = new TokenCacheStore();
    expect(store.load({ clientId: CLIENT_ID, apiBaseUrl: API_BASE })).toBeNull();
  });

  it("returns null on a structurally-incomplete file (missing fields)", () => {
    writeFileSync(
      path.join(dir, ".token-cache.json"),
      JSON.stringify({ accessToken: "tok" }),
      { mode: 0o600 },
    );
    const store = new TokenCacheStore();
    expect(store.load({ clientId: CLIENT_ID, apiBaseUrl: API_BASE })).toBeNull();
  });

  it("clear() removes the cache file and is idempotent", async () => {
    const store = new TokenCacheStore();
    const id = computeCacheIdentity({ clientId: CLIENT_ID, apiBaseUrl: API_BASE });
    await store.save({
      accessToken: "tok",
      expiresAt: Date.now() + 60_000,
      ttlMs: 86_400_000,
      ...id,
    });

    store.clear();
    expect(store.load({ clientId: CLIENT_ID, apiBaseUrl: API_BASE })).toBeNull();

    // Second clear must not throw — ENOENT is swallowed.
    expect(() => store.clear()).not.toThrow();
  });

  it("checkPermissions() reports 'no token cache file' when missing", async () => {
    const store = new TokenCacheStore();
    const result = await store.checkPermissions();
    expect(result.secure).toBe(true);
    expect(result.detail).toContain("No token cache");
  });

  it.skipIf(process.platform === "win32")(
    "checkPermissions() reports insecure perms on Unix when group/other can read",
    async () => {
      // Bypass safeWriteFileSync (which would write 0o600) so we can
      // pin a known-insecure mode for the doctor check.
      const file = path.join(dir, ".token-cache.json");
      writeFileSync(file, "{}", { mode: 0o644 });

      const store = new TokenCacheStore();
      const result = await store.checkPermissions();
      expect(result.secure).toBe(false);
      expect(result.detail).toContain("group/other have access");
      expect(result.detail).toContain("chmod 600");
    },
  );

  it.skipIf(process.platform === "win32")(
    "checkPermissions() reports secure on Unix with mode 0o600",
    async () => {
      const store = new TokenCacheStore();
      const id = computeCacheIdentity({ clientId: CLIENT_ID, apiBaseUrl: API_BASE });
      await store.save({
        accessToken: "tok",
        expiresAt: Date.now() + 60_000,
        ttlMs: 86_400_000,
        ...id,
      });

      const result = await store.checkPermissions();
      expect(result.secure).toBe(true);
      expect(result.detail).toContain("600");
    },
  );

  it("save() is best-effort: a failure inside the write path does not throw", async () => {
    // Point the store at a path that can't be written. We can't easily
    // force a write failure with the real safeWriteFileSync, but we can
    // force `mkdirSync` to fail by pointing at an existing regular file.
    const collidingPath = path.join(dir, "blocking-file");
    writeFileSync(collidingPath, "blocker", { mode: 0o644 });
    process.env.PAX8_CONFIG_DIR = collidingPath;

    const store = new TokenCacheStore();
    const id = computeCacheIdentity({ clientId: CLIENT_ID, apiBaseUrl: API_BASE });
    await expect(
      store.save({
        accessToken: "tok",
        expiresAt: Date.now() + 60_000,
        ttlMs: 86_400_000,
        ...id,
      }),
    ).resolves.toBeUndefined();
  });
});
