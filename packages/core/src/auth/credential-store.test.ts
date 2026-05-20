// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CredentialStore } from "./credential-store.js";
import * as fs from "node:fs/promises";
import * as childProcess from "node:child_process";
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

// On Windows, the production code shells out to `icacls` via
// `execFile` (wrapped in `promisify`) for both file/dir ACL hardening
// and the doctor-style ACL inspection. Mock the unpromisified
// `execFile` so the Windows-conditional tests below can pin the
// command shape and feed canned stdout without touching real ACLs.
//
// `promisify(execFile)` happens at module load time inside
// credential-store.ts, so the mock has to be installed via `vi.mock`
// (which vitest hoists above imports). We swap the named export for
// a stub whose `(file, args, cb)` shape matches what `promisify`
// expects — it invokes `cb(null, { stdout, stderr })` to resolve, or
// `cb(err)` to reject the promisified call.
vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: vi.fn(),
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
    vi.mocked(childProcess.execFile).mockReset();
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

      // Mode gate: the new pre-read stat in getFromFile() refuses to load
      // when group/other bits are set. Return a secure mode here so the
      // happy-path test still exercises the readFile branch.
      vi.mocked(fs.stat).mockResolvedValueOnce({
        mode: 0o100600,
      } as import("node:fs").Stats);
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

      // No file: the mode-check stat returns ENOENT, which getFromFile
      // treats as "no creds" and returns null.
      vi.mocked(fs.stat).mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      );

      const creds = await store.getCredentials();
      expect(creds).toBeNull();
    });

    it("returns null when only PAX8_CLIENT_ID is set", async () => {
      process.env.PAX8_CLIENT_ID = "partial-id";
      delete process.env.PAX8_CLIENT_SECRET;

      vi.mocked(fs.stat).mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      );

      const creds = await store.getCredentials();
      expect(creds).toBeNull();
    });

    it("returns null when file contains invalid JSON", async () => {
      delete process.env.PAX8_CLIENT_ID;
      delete process.env.PAX8_CLIENT_SECRET;

      vi.mocked(fs.stat).mockResolvedValueOnce({
        mode: 0o100600,
      } as import("node:fs").Stats);
      vi.mocked(fs.readFile).mockResolvedValueOnce("not json");

      const creds = await store.getCredentials();
      expect(creds).toBeNull();
    });

    it("returns null when file is missing required fields", async () => {
      delete process.env.PAX8_CLIENT_ID;
      delete process.env.PAX8_CLIENT_SECRET;

      vi.mocked(fs.stat).mockResolvedValueOnce({
        mode: 0o100600,
      } as import("node:fs").Stats);
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({ clientId: "only-id" })
      );

      const creds = await store.getCredentials();
      expect(creds).toBeNull();
    });

    // L-1: refuse to load a world-/group-readable credentials file. The
    // pre-read stat in getFromFile() must throw a clear, fix-it-style error
    // when group/other bits are set on POSIX. On Windows the production
    // code skips the check (no POSIX mode bits), so this test skips there.
    it.skipIf(process.platform === "win32")(
      "refuses to load when credentials file is world/group readable on Unix (L-1)",
      async () => {
        delete process.env.PAX8_CLIENT_ID;
        delete process.env.PAX8_CLIENT_SECRET;

        vi.mocked(fs.stat).mockResolvedValueOnce({
          mode: 0o100644,
        } as import("node:fs").Stats);

        await expect(store.getCredentials()).rejects.toThrow(
          /Refusing to load credentials.*chmod 600/,
        );
        // readFile must NOT be reached when the mode gate trips — otherwise
        // the credentials are sourced from an insecure file even though we
        // "refused" them.
        expect(fs.readFile).not.toHaveBeenCalled();
      },
    );

    // Owner-only non-600 mode (e.g., 0o700) is still secure under our
    // group/other gate — the gate is `mode & 0o077 !== 0`, which is false
    // when only owner bits are set. Pin this so a future tightening of
    // the gate to "exactly 600" is a deliberate decision, not a drive-by.
    it.skipIf(process.platform === "win32")(
      "still loads when owner-only non-600 mode is set (e.g. 0o700) on Unix",
      async () => {
        delete process.env.PAX8_CLIENT_ID;
        delete process.env.PAX8_CLIENT_SECRET;

        vi.mocked(fs.stat).mockResolvedValueOnce({
          mode: 0o100700,
        } as import("node:fs").Stats);
        vi.mocked(fs.readFile).mockResolvedValueOnce(
          JSON.stringify({ clientId: "ok-id", clientSecret: "ok-secret" }),
        );

        const creds = await store.getCredentials();
        expect(creds).toEqual({ clientId: "ok-id", clientSecret: "ok-secret" });
      },
    );
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

  // Windows-equivalent coverage for the icacls path (closes #189).
  // Mirrors the POSIX "creates dir, secures it, writes file" test
  // above. On Windows the lockdown happens via `icacls` rather than
  // `chmod`, so we pin the command shape and arg vector for both the
  // directory pass (run before the write) and the file pass (run
  // after the write). These tests skip cleanly on Unix runners.
  describe.skipIf(process.platform !== "win32")("saveCredentials on Windows", () => {
    it("secures config dir and credentials file via icacls", async () => {
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

      // `promisify(execFile)` calls the underlying execFile as
      // (file, args, cb). Resolve with empty stdout/stderr — the
      // production code ignores the output on the secure paths.
      const execFileMock = vi.mocked(childProcess.execFile) as unknown as ReturnType<typeof vi.fn>;
      execFileMock.mockImplementation(((
        _file: string,
        _args: readonly string[],
        cb: (err: NodeJS.ErrnoException | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb(null, { stdout: "", stderr: "" });
      }) as unknown as typeof childProcess.execFile);

      await store.saveCredentials("my-id", "my-secret");

      expect(fs.mkdir).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true });
      // chmod must NOT be used on Windows — the production code
      // routes the dir/file lockdown through icacls instead.
      expect(fs.chmod).not.toHaveBeenCalled();

      const username = os.userInfo().username;
      // Two icacls invocations: one for the dir (pre-write) and one
      // for the file (post-write). Order matters: the dir is hardened
      // first so the in-flight file write inherits the locked-down
      // parent.
      expect(execFileMock).toHaveBeenCalledTimes(2);
      expect(execFileMock).toHaveBeenNthCalledWith(
        1,
        "icacls",
        [CONFIG_DIR, "/inheritance:r", "/grant:r", `${username}:(OI)(CI)(F)`],
        expect.any(Function),
      );
      expect(execFileMock).toHaveBeenNthCalledWith(
        2,
        "icacls",
        [CREDENTIALS_FILE, "/inheritance:r", "/grant:r", `${username}:(F)`],
        expect.any(Function),
      );

      // The file write itself still goes through safeWriteFileSync,
      // so we cross-check that the credentials payload landed at the
      // expected path with the same 0o600 mode bag as the POSIX path.
      // (O_NOFOLLOW is 0 on Windows; the safe-write helper still
      // requests it, but the OS no-ops the bit.)
      expect(openSync).toHaveBeenCalledTimes(1);
      const [calledPath, , mode] = openSync.mock.calls[0] as [string, number, number];
      expect(calledPath).toBe(CREDENTIALS_FILE);
      expect(mode).toBe(0o600);

      expect(writeSync).toHaveBeenCalledTimes(1);
      const writtenBuf = writeSync.mock.calls[0][1] as Buffer;
      expect(writtenBuf.toString("utf-8")).toBe(
        JSON.stringify({ clientId: "my-id", clientSecret: "my-secret" }, null, 2),
      );
    });

    it("does not throw when icacls hardening fails (best-effort)", async () => {
      // If icacls is missing or errors, the file is still written
      // and saveCredentials must not throw — the doctor check
      // surfaces the insecure permissions later. This is the
      // Windows analogue of "POSIX chmod best-effort", except the
      // POSIX flow doesn't actually try/catch chmod; on Windows the
      // production code swallows icacls errors explicitly.
      const fsSync = await import("node:fs");
      const openSync = fsSync.openSync as unknown as ReturnType<typeof vi.fn>;
      const writeSync = fsSync.writeSync as unknown as ReturnType<typeof vi.fn>;
      openSync.mockReset();
      writeSync.mockReset();
      openSync.mockReturnValue(7);
      writeSync.mockReturnValue(0);

      vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined);

      const execFileMock = vi.mocked(childProcess.execFile) as unknown as ReturnType<typeof vi.fn>;
      execFileMock.mockImplementation(((
        _file: string,
        _args: readonly string[],
        cb: (err: NodeJS.ErrnoException | null) => void,
      ) => {
        cb(Object.assign(new Error("icacls not found"), { code: "ENOENT" }));
      }) as unknown as typeof childProcess.execFile);

      await expect(store.saveCredentials("my-id", "my-secret")).resolves.toBeUndefined();
      expect(openSync).toHaveBeenCalledTimes(1);
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

    // Windows-equivalent coverage for the icacls inspection path
    // (closes #189). The Unix path parses `mode & 0o777`; the Windows
    // path shells out to `icacls <file>` and scans stdout for
    // known-insecure principals (BUILTIN\Users, Everyone,
    // Authenticated Users). Each `it.skipIf(process.platform !==
    // "win32")` mirror feeds canned icacls stdout to assert the same
    // secure/insecure invariant the POSIX tests assert via stat mode
    // bits.
    it.skipIf(process.platform !== "win32")(
      "returns secure when icacls shows only the current user on Windows",
      async () => {
        vi.mocked(fs.access).mockResolvedValueOnce(undefined);
        const username = os.userInfo().username;
        const stdout = `${CREDENTIALS_FILE} ${username}:(F)\n\nSuccessfully processed 1 files; Failed processing 0 files\n`;
        const execFileMock = vi.mocked(
          childProcess.execFile,
        ) as unknown as ReturnType<typeof vi.fn>;
        execFileMock.mockImplementation(((
          _file: string,
          _args: readonly string[],
          cb: (err: NodeJS.ErrnoException | null, result: { stdout: string; stderr: string }) => void,
        ) => {
          cb(null, { stdout, stderr: "" });
        }) as unknown as typeof childProcess.execFile);

        const result = await store.checkPermissions();
        expect(result.secure).toBe(true);
        expect(result.detail).toContain("ACLs");
        expect(execFileMock).toHaveBeenCalledWith(
          "icacls",
          [CREDENTIALS_FILE],
          expect.any(Function),
        );
      },
    );

    it.skipIf(process.platform !== "win32")(
      "returns insecure when icacls shows BUILTIN\\Users has access on Windows",
      async () => {
        vi.mocked(fs.access).mockResolvedValueOnce(undefined);
        const username = os.userInfo().username;
        // Real icacls output for a not-yet-hardened file: inherited
        // BUILTIN\Users + Authenticated Users entries from the parent
        // directory.
        const stdout =
          `${CREDENTIALS_FILE} BUILTIN\\Users:(I)(RX)\n` +
          `                    NT AUTHORITY\\Authenticated Users:(I)(M)\n` +
          `                    ${username}:(F)\n` +
          `\nSuccessfully processed 1 files; Failed processing 0 files\n`;
        const execFileMock = vi.mocked(
          childProcess.execFile,
        ) as unknown as ReturnType<typeof vi.fn>;
        execFileMock.mockImplementation(((
          _file: string,
          _args: readonly string[],
          cb: (err: NodeJS.ErrnoException | null, result: { stdout: string; stderr: string }) => void,
        ) => {
          cb(null, { stdout, stderr: "" });
        }) as unknown as typeof childProcess.execFile);

        const result = await store.checkPermissions();
        expect(result.secure).toBe(false);
        // The fix-it hint must surface the icacls remediation
        // command — symmetric to the POSIX "chmod 600 ..." hint.
        expect(result.detail).toContain("icacls");
        expect(result.detail).toContain("/inheritance:r");
      },
    );

    it.skipIf(process.platform !== "win32")(
      "returns insecure when icacls shows Everyone has access on Windows",
      async () => {
        // Variant of the previous test pinning the "Everyone" branch
        // of the insecure-principals check, so a future refactor
        // can't drop one of the three known-bad SIDs without a test
        // failure.
        vi.mocked(fs.access).mockResolvedValueOnce(undefined);
        const username = os.userInfo().username;
        const stdout =
          `${CREDENTIALS_FILE} Everyone:(F)\n` +
          `                    ${username}:(F)\n` +
          `\nSuccessfully processed 1 files; Failed processing 0 files\n`;
        const execFileMock = vi.mocked(
          childProcess.execFile,
        ) as unknown as ReturnType<typeof vi.fn>;
        execFileMock.mockImplementation(((
          _file: string,
          _args: readonly string[],
          cb: (err: NodeJS.ErrnoException | null, result: { stdout: string; stderr: string }) => void,
        ) => {
          cb(null, { stdout, stderr: "" });
        }) as unknown as typeof childProcess.execFile);

        const result = await store.checkPermissions();
        expect(result.secure).toBe(false);
        expect(result.detail).toContain("icacls");
      },
    );

    it.skipIf(process.platform !== "win32")(
      "falls back to home-dir heuristic when icacls itself fails on Windows",
      async () => {
        // POSIX analogue: "returns insecure when stat fails".
        // The Windows path is intentionally more forgiving — if
        // icacls isn't on PATH or errors out, the code falls back
        // to checking whether the file lives under the user's home
        // directory and reports secure-with-caveat. This test pins
        // that fallback so a future refactor can't quietly flip the
        // failure mode to "insecure".
        vi.mocked(fs.access).mockResolvedValueOnce(undefined);
        const execFileMock = vi.mocked(
          childProcess.execFile,
        ) as unknown as ReturnType<typeof vi.fn>;
        execFileMock.mockImplementation(((
          _file: string,
          _args: readonly string[],
          cb: (err: NodeJS.ErrnoException | null) => void,
        ) => {
          cb(Object.assign(new Error("icacls not found"), { code: "ENOENT" }));
        }) as unknown as typeof childProcess.execFile);

        const result = await store.checkPermissions();
        // ~/.pax8/credentials.json is under the user's home dir on
        // any normal Windows runner, so the fallback returns
        // secure-with-caveat rather than outright insecure.
        expect(result.secure).toBe(true);
        expect(result.detail).toContain("could not verify ACLs");
      },
    );
  });
});
