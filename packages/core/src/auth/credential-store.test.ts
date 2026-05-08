// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CredentialStore } from "./credential-store.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

vi.mock("node:fs/promises");

// `safeWriteFileSync` (used by saveCredentials for #262 symlink protection)
// reaches into `node:fs` directly. Mock it so the test stays hermetic and
// can pin the openSync flag bag — which is the whole point of the
// safe-write helper. The real node:fs constants are still needed (we
// assert flags like O_NOFOLLOW), so we preserve them via importActual.
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    openSync: vi.fn(),
    writeSync: vi.fn(),
    closeSync: vi.fn(),
  };
});

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

  describe("hasCredentials", () => {
    it("returns true when env vars are set, without touching the file", async () => {
      process.env.PAX8_CLIENT_ID = "env-id";
      process.env.PAX8_CLIENT_SECRET = "env-secret";

      expect(await store.hasCredentials()).toBe(true);
      expect(fs.access).not.toHaveBeenCalled();
    });

    it("returns true when only the credentials file exists", async () => {
      delete process.env.PAX8_CLIENT_ID;
      delete process.env.PAX8_CLIENT_SECRET;
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);

      expect(await store.hasCredentials()).toBe(true);
      expect(fs.access).toHaveBeenCalledWith(CREDENTIALS_FILE, expect.any(Number));
      // hasCredentials must NOT read or parse the file body.
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it("returns false when neither env vars nor file are present", async () => {
      delete process.env.PAX8_CLIENT_ID;
      delete process.env.PAX8_CLIENT_SECRET;
      vi.mocked(fs.access).mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      );

      expect(await store.hasCredentials()).toBe(false);
    });

    it("returns false when only one env var half is set", async () => {
      process.env.PAX8_CLIENT_ID = "partial";
      delete process.env.PAX8_CLIENT_SECRET;
      vi.mocked(fs.access).mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      );

      expect(await store.hasCredentials()).toBe(false);
    });
  });

  describe.skipIf(process.platform === "win32")("saveCredentials", () => {
    it("creates config dir, secures it, and writes credentials file on Unix", async () => {
      // #262: saveCredentials now uses safeWriteFileSync for the file
      // write so the resulting file gets O_NOFOLLOW symlink protection
      // and 0o600 permissions atomically at create time. The byte-level
      // round-trip is covered by the dedicated safe-write tests in
      // packages/core/src/config/loader-extended.test.ts; here we pin the
      // call shape — protective flags + mode + correct destination — so
      // a future refactor can't silently drop the protection.
      const fsSync = await import("node:fs");
      const openSync = fsSync.openSync as unknown as ReturnType<typeof vi.fn>;
      const writeSync = fsSync.writeSync as unknown as ReturnType<typeof vi.fn>;
      const closeSync = fsSync.closeSync as unknown as ReturnType<typeof vi.fn>;
      openSync.mockReset();
      writeSync.mockReset();
      closeSync.mockReset();
      openSync.mockReturnValue(7);
      writeSync.mockReturnValue(0);

      vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined);
      vi.mocked(fs.chmod).mockResolvedValueOnce(undefined);

      await store.saveCredentials("my-id", "my-secret");

      expect(fs.mkdir).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true });
      expect(fs.chmod).toHaveBeenCalledWith(CONFIG_DIR, 0o700);

      expect(openSync).toHaveBeenCalledTimes(1);
      const [calledPath, flags, mode] = openSync.mock.calls[0] as [
        string,
        number,
        number,
      ];
      expect(calledPath).toBe(CREDENTIALS_FILE);
      expect(mode).toBe(0o600);
      const C = fsSync.constants;
      expect(flags & C.O_WRONLY).toBe(C.O_WRONLY);
      expect(flags & C.O_CREAT).toBe(C.O_CREAT);
      expect(flags & C.O_TRUNC).toBe(C.O_TRUNC);
      // O_NOFOLLOW is POSIX-only; on Linux/macOS it's a non-zero constant.
      expect(flags & C.O_NOFOLLOW).toBe(C.O_NOFOLLOW);

      expect(writeSync).toHaveBeenCalledTimes(1);
      const writtenBuf = writeSync.mock.calls[0][1] as Buffer;
      expect(writtenBuf.toString("utf-8")).toBe(
        JSON.stringify({ clientId: "my-id", clientSecret: "my-secret" }, null, 2),
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

    it.skipIf(process.platform === "win32")("returns secure when file has mode 600 on Unix", async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.stat).mockResolvedValueOnce({
        mode: 0o100600,
      } as import("node:fs").Stats);

      const result = await store.checkPermissions();
      expect(result.secure).toBe(true);
      expect(result.detail).toContain("600");
    });

    it.skipIf(process.platform === "win32")("returns insecure when file has group/other permissions on Unix", async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.stat).mockResolvedValueOnce({
        mode: 0o100644,
      } as import("node:fs").Stats);

      const result = await store.checkPermissions();
      expect(result.secure).toBe(false);
      expect(result.detail).toContain("group/other have access");
      expect(result.detail).toContain("chmod 600");
    });

    it.skipIf(process.platform === "win32")("returns secure for owner-only non-600 mode (e.g., 700) on Unix", async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.stat).mockResolvedValueOnce({
        mode: 0o100700,
      } as import("node:fs").Stats);

      const result = await store.checkPermissions();
      expect(result.secure).toBe(true);
      expect(result.detail).toContain("owner-only access");
    });

    it.skipIf(process.platform === "win32")("returns insecure when stat fails on Unix", async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.stat).mockRejectedValueOnce(new Error("permission denied"));

      const result = await store.checkPermissions();
      expect(result.secure).toBe(false);
      expect(result.detail).toContain("Could not stat");
    });
  });
});
