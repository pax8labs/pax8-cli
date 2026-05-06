// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CredentialStore } from "./credential-store.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

vi.mock("node:fs/promises");

const CONFIG_DIR = path.join(os.homedir(), ".pax8");
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials.json");

describe("CredentialStore", () => {
  let store: CredentialStore;
  const originalEnv = process.env;
  const originalPlatform = process.platform;

  beforeEach(() => {
    store = new CredentialStore();
    process.env = { ...originalEnv };
    vi.mocked(fs.readFile).mockReset();
    vi.mocked(fs.writeFile).mockReset();
    vi.mocked(fs.mkdir).mockReset();
    vi.mocked(fs.unlink).mockReset();
    vi.mocked(fs.access).mockReset();
    vi.mocked(fs.stat).mockReset();
    vi.mocked(fs.chmod).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process, "platform", { value: originalPlatform });
    vi.restoreAllMocks();
  });

  describe("static properties", () => {
    it("exposes credentialsFilePath", () => {
      expect(CredentialStore.credentialsFilePath).toBe(CREDENTIALS_FILE);
    });

    it("exposes configDirPath", () => {
      expect(CredentialStore.configDirPath).toBe(CONFIG_DIR);
    });
  });

  describe("getCredentials", () => {
    it("reads from environment variables first", async () => {
      process.env.PAX8_CLIENT_ID = "env-id";
      process.env.PAX8_CLIENT_SECRET = "env-secret";

      const creds = await store.getCredentials();
      expect(creds).toEqual({ clientId: "env-id", clientSecret: "env-secret" });
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it("falls back to file when env vars are missing", async () => {
      delete process.env.PAX8_CLIENT_ID;
      delete process.env.PAX8_CLIENT_SECRET;

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({ clientId: "file-id", clientSecret: "file-secret" })
      );

      const creds = await store.getCredentials();
      expect(creds).toEqual({ clientId: "file-id", clientSecret: "file-secret" });
      expect(fs.readFile).toHaveBeenCalledWith(CREDENTIALS_FILE, "utf-8");
    });

    it("returns null when no credentials available", async () => {
      delete process.env.PAX8_CLIENT_ID;
      delete process.env.PAX8_CLIENT_SECRET;

      vi.mocked(fs.readFile).mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      );

      const creds = await store.getCredentials();
      expect(creds).toBeNull();
    });

    it("returns null when only PAX8_CLIENT_ID is set", async () => {
      process.env.PAX8_CLIENT_ID = "partial-id";
      delete process.env.PAX8_CLIENT_SECRET;

      vi.mocked(fs.readFile).mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      );

      const creds = await store.getCredentials();
      expect(creds).toBeNull();
    });

    it("returns null when file contains invalid JSON", async () => {
      delete process.env.PAX8_CLIENT_ID;
      delete process.env.PAX8_CLIENT_SECRET;

      vi.mocked(fs.readFile).mockResolvedValueOnce("not json");

      const creds = await store.getCredentials();
      expect(creds).toBeNull();
    });

    it("returns null when file is missing required fields", async () => {
      delete process.env.PAX8_CLIENT_ID;
      delete process.env.PAX8_CLIENT_SECRET;

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({ clientId: "only-id" })
      );

      const creds = await store.getCredentials();
      expect(creds).toBeNull();
    });
  });

  describe("saveCredentials", () => {
    it("creates config dir, secures it, and writes credentials file on Unix", async () => {
      vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined);
      vi.mocked(fs.chmod).mockResolvedValueOnce(undefined);
      vi.mocked(fs.writeFile).mockResolvedValueOnce(undefined);

      await store.saveCredentials("my-id", "my-secret");

      expect(fs.mkdir).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true });
      expect(fs.chmod).toHaveBeenCalledWith(CONFIG_DIR, 0o700);
      expect(fs.writeFile).toHaveBeenCalledWith(
        CREDENTIALS_FILE,
        JSON.stringify({ clientId: "my-id", clientSecret: "my-secret" }, null, 2),
        { mode: 0o600 }
      );
    });
  });

  describe("clearCredentials", () => {
    it("removes the credentials file", async () => {
      vi.mocked(fs.unlink).mockResolvedValueOnce(undefined);

      await store.clearCredentials();
      expect(fs.unlink).toHaveBeenCalledWith(CREDENTIALS_FILE);
    });

    it("does not throw when file does not exist", async () => {
      vi.mocked(fs.unlink).mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      );

      await expect(store.clearCredentials()).resolves.toBeUndefined();
    });

    it("throws on unexpected errors", async () => {
      vi.mocked(fs.unlink).mockRejectedValueOnce(
        Object.assign(new Error("EPERM"), { code: "EPERM" })
      );

      await expect(store.clearCredentials()).rejects.toThrow("EPERM");
    });
  });

  describe("checkPermissions", () => {
    it("returns secure when no credentials file exists", async () => {
      vi.mocked(fs.access).mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      );

      const result = await store.checkPermissions();
      expect(result.secure).toBe(true);
      expect(result.detail).toContain("No credentials file");
    });

    it("returns secure when file has mode 600 on Unix", async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.stat).mockResolvedValueOnce({
        mode: 0o100600,
      } as import("node:fs").Stats);

      const result = await store.checkPermissions();
      expect(result.secure).toBe(true);
      expect(result.detail).toContain("600");
    });

    it("returns insecure when file has group/other permissions on Unix", async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.stat).mockResolvedValueOnce({
        mode: 0o100644,
      } as import("node:fs").Stats);

      const result = await store.checkPermissions();
      expect(result.secure).toBe(false);
      expect(result.detail).toContain("group/other have access");
      expect(result.detail).toContain("chmod 600");
    });

    it("returns secure for owner-only non-600 mode (e.g., 700) on Unix", async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.stat).mockResolvedValueOnce({
        mode: 0o100700,
      } as import("node:fs").Stats);

      const result = await store.checkPermissions();
      expect(result.secure).toBe(true);
      expect(result.detail).toContain("owner-only access");
    });

    it("returns insecure when stat fails on Unix", async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.stat).mockRejectedValueOnce(new Error("permission denied"));

      const result = await store.checkPermissions();
      expect(result.secure).toBe(false);
      expect(result.detail).toContain("Could not stat");
    });
  });
});
