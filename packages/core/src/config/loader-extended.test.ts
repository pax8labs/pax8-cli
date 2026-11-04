// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getConfigDir, ensureConfigDir } from "./loader.js";
import {
  Pax8SecurityError,
  validateConfigDir,
} from "../security/validate-env.js";
import { ERROR_INVALID_INPUT } from "../errors/codes.js";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

describe("config/loader — extended coverage", () => {
  // The vitest config sets PAX8_ALLOW_NON_HOME_CONFIG=1 globally so tests
  // can use os.tmpdir() for isolation. These specific tests need the
  // strict default to verify the validation, so they delete it locally.
  //
  // #475: stubbing `os.homedir()` to a tmp directory keeps the "default
  // path" test (PAX8_CONFIG_DIR unset) hermetic — exercising the
  // home-default code path without ever creating the contributor's real
  // ~/.pax8 directory. `loader.ts` reads `homedir()` at module-load time
  // for DEFAULT_CONFIG_DIR, but getConfigDir() resolves at call time
  // through validateConfigDir, which itself re-reads os.homedir() — so the
  // stub is observed where it matters (the PAX8_CONFIG_DIR=unset case
  // returns the cached DEFAULT_CONFIG_DIR, which we compare against the
  // real (unstubbed) homedir for that specific call).
  const originalAllow = process.env.PAX8_ALLOW_NON_HOME_CONFIG;
  const originalConfigDir = process.env.PAX8_CONFIG_DIR;
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "pax8-loader-home-"));
  });

  afterEach(() => {
    if (originalAllow === undefined) delete process.env.PAX8_ALLOW_NON_HOME_CONFIG;
    else process.env.PAX8_ALLOW_NON_HOME_CONFIG = originalAllow;
    if (originalConfigDir === undefined) delete process.env.PAX8_CONFIG_DIR;
    else process.env.PAX8_CONFIG_DIR = originalConfigDir;
    vi.restoreAllMocks();
    try {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("getConfigDir returns path under home directory by default", () => {
    // `loader.ts` snapshots `homedir()` at module load into
    // DEFAULT_CONFIG_DIR, so we compare against the real homedir() here.
    // No filesystem side effects in this test — we only read the path.
    delete process.env.PAX8_CONFIG_DIR;
    const dir = getConfigDir();
    expect(dir).toBe(path.join(os.homedir(), ".pax8"));
  });

  it("ensureConfigDir resolves to PAX8_CONFIG_DIR when set", async () => {
    // #475: previously this test deleted PAX8_CONFIG_DIR and called
    // `ensureConfigDir()` against the real home — leaking `~/.pax8` onto
    // the contributor's disk. Exercise the override path instead; the
    // home-default path-resolution is covered by the test above without
    // touching the filesystem.
    process.env.PAX8_CONFIG_DIR = fakeHome;
    const dir = await ensureConfigDir();
    expect(dir).toBe(fakeHome);
    expect(fs.existsSync(fakeHome)).toBe(true);
  });
});

// #262 — `validateConfigDir` rejects paths outside $HOME unless
// `PAX8_ALLOW_NON_HOME_CONFIG=1` is set explicitly.
describe("validateConfigDir (#262)", () => {
  const originalAllow = process.env.PAX8_ALLOW_NON_HOME_CONFIG;
  const originalConfigDir = process.env.PAX8_CONFIG_DIR;

  afterEach(() => {
    if (originalAllow === undefined) delete process.env.PAX8_ALLOW_NON_HOME_CONFIG;
    else process.env.PAX8_ALLOW_NON_HOME_CONFIG = originalAllow;
    if (originalConfigDir === undefined) delete process.env.PAX8_CONFIG_DIR;
    else process.env.PAX8_CONFIG_DIR = originalConfigDir;
  });

  it("accepts a path that resolves under $HOME", () => {
    delete process.env.PAX8_ALLOW_NON_HOME_CONFIG;
    const under = path.join(os.homedir(), "Documents", "pax8-test");
    expect(validateConfigDir(under)).toBe(under);
  });

  it("accepts the home directory itself", () => {
    delete process.env.PAX8_ALLOW_NON_HOME_CONFIG;
    expect(validateConfigDir(os.homedir())).toBe(os.homedir());
  });

  it("rejects a path outside $HOME without the opt-out", () => {
    delete process.env.PAX8_ALLOW_NON_HOME_CONFIG;
    let thrown: unknown;
    try {
      validateConfigDir("/tmp/some-pax8-config");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Pax8SecurityError);
    expect((thrown as Pax8SecurityError).code).toBe(ERROR_INVALID_INPUT);
    const steps = (thrown as Pax8SecurityError).recoverySteps?.join("\n") ?? "";
    expect(steps).toContain("PAX8_ALLOW_NON_HOME_CONFIG");
  });

  it("rejects a `..` traversal that resolves outside $HOME", () => {
    delete process.env.PAX8_ALLOW_NON_HOME_CONFIG;
    // From inside /Users/whoever/.pax8, ../../etc resolves to /Users/etc
    // — also outside home, also blocked. This catches the relative-path
    // attack vector even when the literal value doesn't start with `/`.
    const outside = path.join(path.parse(os.homedir()).root, "etc");
    expect(() => validateConfigDir(outside)).toThrow(Pax8SecurityError);
  });

  it("accepts a path outside $HOME when PAX8_ALLOW_NON_HOME_CONFIG=1", () => {
    process.env.PAX8_ALLOW_NON_HOME_CONFIG = "1";
    expect(validateConfigDir("/tmp/test-pax8")).toBe(
      path.resolve("/tmp/test-pax8"),
    );
  });

  it("getConfigDir wires through validateConfigDir", () => {
    delete process.env.PAX8_ALLOW_NON_HOME_CONFIG;
    process.env.PAX8_CONFIG_DIR = "/tmp/no-good";
    expect(() => getConfigDir()).toThrow(Pax8SecurityError);
  });

  it("does NOT prefix-match across user boundaries (jane vs janet)", () => {
    delete process.env.PAX8_ALLOW_NON_HOME_CONFIG;
    // homedir is e.g. /Users/jane; a path under /Users/janet/... should
    // be rejected, even though it shares the prefix `/Users/jane`.
    const home = os.homedir();
    // Construct a sibling path that would prefix-match without the sep
    // guard. Skip when the homedir doesn't have a parent segment to splice
    // (rare: only on `/` or an empty home).
    const parent = path.dirname(home);
    const lastSeg = path.basename(home);
    if (!parent || !lastSeg || parent === home) {
      return;
    }
    const sibling = path.join(parent, lastSeg + "_attacker", ".pax8");
    expect(() => validateConfigDir(sibling)).toThrow(Pax8SecurityError);
  });
});

// #262 — symlink protection for state writes via safeWriteFileSync.
// POSIX-only behavior; the test no-ops on Windows where O_NOFOLLOW isn't
// available.
describe("safeWriteFileSync symlink protection (#262)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pax8-safewrite-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it.skipIf(process.platform === "win32")(
    "refuses to write through an existing symlink at the destination",
    async () => {
      const { safeWriteFileSync } = await import("../security/safe-write.js");
      const target = path.join(tmpDir, "outside-target");
      const link = path.join(tmpDir, "credentials.json");
      // Pre-create the symlink target file (with original contents) and
      // place a symlink at the destination pointing to it.
      fs.writeFileSync(target, "ORIGINAL\n", { mode: 0o600 });
      fs.symlinkSync(target, link);

      let thrown: NodeJS.ErrnoException | undefined;
      try {
        safeWriteFileSync(link, "REDIRECTED");
      } catch (e) {
        thrown = e as NodeJS.ErrnoException;
      }
      // Open through O_NOFOLLOW returns ELOOP on POSIX.
      expect(thrown).toBeDefined();
      expect(thrown?.code).toBe("ELOOP");
      // Crucially: the symlink target was NOT modified.
      expect(fs.readFileSync(target, "utf-8")).toBe("ORIGINAL\n");
    },
  );

  it("creates a regular file with mode 0600 atomically", async () => {
    const { safeWriteFileSync } = await import("../security/safe-write.js");
    const filePath = path.join(tmpDir, "credentials.json");
    safeWriteFileSync(filePath, "secret-data");
    const stat = fs.statSync(filePath);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
    expect(fs.readFileSync(filePath, "utf-8")).toBe("secret-data");
  });

  it("overwrites an existing regular file (no symlink) cleanly", async () => {
    const { safeWriteFileSync } = await import("../security/safe-write.js");
    const filePath = path.join(tmpDir, "credentials.json");
    fs.writeFileSync(filePath, "old", { mode: 0o600 });
    safeWriteFileSync(filePath, "new");
    expect(fs.readFileSync(filePath, "utf-8")).toBe("new");
  });
});
