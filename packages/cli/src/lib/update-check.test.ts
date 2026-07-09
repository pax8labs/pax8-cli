// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  isNewerVersion,
  readCachedUpdateInfo,
  getApiValidationUpgradeHint,
  truthyEnv,
  presenceEnv,
} from "./update-check.js";

/**
 * In-process unit tests for the parts of `update-check.ts` that don't
 * require a subprocess. The end-to-end render path is covered by
 * `__tests__/update-notifier.test.ts`.
 */

describe("isNewerVersion", () => {
  it("returns false when versions are equal", () => {
    expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
  });

  it("returns true for a newer patch", () => {
    expect(isNewerVersion("1.2.4", "1.2.3")).toBe(true);
  });

  it("returns true for a newer minor", () => {
    expect(isNewerVersion("1.3.0", "1.2.9")).toBe(true);
  });

  it("returns true for a newer major", () => {
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
  });

  it("returns false when the candidate is older", () => {
    expect(isNewerVersion("1.2.3", "1.2.4")).toBe(false);
    expect(isNewerVersion("0.9.0", "1.0.0")).toBe(false);
  });

  it("treats missing components as zero", () => {
    expect(isNewerVersion("1.2", "1.1.9")).toBe(true);
    expect(isNewerVersion("1", "0.9.9")).toBe(true);
  });

  it("strips pre-release suffixes when comparing numeric prefixes", () => {
    // The numeric prefix of `1.0.1-rc.1` (1.0.1) is greater than the
    // numeric prefix of `1.0.0` — that's the answer the comparator must
    // return regardless of how pre-release tags sort lexically. We
    // don't aim to be RFC-2119 semver-compliant here; update-notifier
    // itself uses `semverGt` for the canonical compare. This is just a
    // floor for the synchronous read path that doesn't pull in semver.
    expect(isNewerVersion("1.0.1-rc.1", "1.0.0")).toBe(true);
  });
});

describe("readCachedUpdateInfo + getApiValidationUpgradeHint", () => {
  let tmp: string;
  const originalConfigDir = process.env.PAX8_CONFIG_DIR;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pax8-update-check-"));
    process.env.PAX8_CONFIG_DIR = tmp;
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (originalConfigDir === undefined) {
      delete process.env.PAX8_CONFIG_DIR;
    } else {
      process.env.PAX8_CONFIG_DIR = originalConfigDir;
    }
  });

  it("returns null when no cache file exists", () => {
    expect(readCachedUpdateInfo()).toBeNull();
    expect(getApiValidationUpgradeHint()).toBeNull();
  });

  it("returns null when the cache file is malformed JSON", () => {
    fs.writeFileSync(path.join(tmp, "update-check.json"), "{not json");
    expect(readCachedUpdateInfo()).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    fs.writeFileSync(
      path.join(tmp, "update-check.json"),
      JSON.stringify({ latest: "9.9.9" }),
    );
    expect(readCachedUpdateInfo()).toBeNull();
  });

  it("returns null when the cached latest is not newer than the running version", () => {
    // Use a sub-zero version that's older than anything @pax8/cli will
    // ever be at runtime, so `isNewerVersion(latest, running)` is false.
    fs.writeFileSync(
      path.join(tmp, "update-check.json"),
      JSON.stringify({
        latest: "0.0.0",
        current: "0.0.0",
        checkedAt: Date.now(),
      }),
    );
    expect(readCachedUpdateInfo()).toBeNull();
    expect(getApiValidationUpgradeHint()).toBeNull();
  });

  it("returns the cached record when the latest is newer than the running version", () => {
    fs.writeFileSync(
      path.join(tmp, "update-check.json"),
      JSON.stringify({
        latest: "999.0.0",
        current: "0.0.1",
        type: "major",
        checkedAt: 12345,
      }),
    );
    const info = readCachedUpdateInfo();
    expect(info).not.toBeNull();
    expect(info?.latest).toBe("999.0.0");
    expect(info?.type).toBe("major");

    const hint = getApiValidationUpgradeHint();
    expect(hint).toContain("999.0.0");
    expect(hint).toContain("pax8 upgrade");
  });
});

describe("truthyEnv", () => {
  const FLAG = "PAX8_TRUTHY_ENV_FIXTURE";

  afterEach(() => {
    delete process.env[FLAG];
  });

  it("returns false when the variable is unset", () => {
    expect(truthyEnv(FLAG)).toBe(false);
  });

  it.each(["1", "true", "yes", "on", "TRUE", "Yes", "  1  "])(
    "treats %s as truthy",
    (v) => {
      process.env[FLAG] = v;
      expect(truthyEnv(FLAG)).toBe(true);
    },
  );

  // Critically: realistic non-token values that some env conventions set
  // (e.g. `CI=github` from a provider that uses platform identifiers,
  // `NO_UPDATE_NOTIFIER=set` from an operator who didn't read the docs).
  // For Pax8-owned `=1`-shape flags these MUST read as falsy — that's
  // the strict-token guarantee partners rely on. Presence-shaped flags
  // go through `presenceEnv` instead.
  it.each([
    "0",
    "false",
    "no",
    "off",
    "",
    "  ",
    "anything-else",
    "github",
    "set",
    "enabled",
  ])("treats %s as falsy", (v) => {
    process.env[FLAG] = v;
    expect(truthyEnv(FLAG)).toBe(false);
  });
});

describe("presenceEnv", () => {
  const FLAG = "PAX8_PRESENCE_ENV_FIXTURE";

  afterEach(() => {
    delete process.env[FLAG];
  });

  it("returns false when the variable is unset", () => {
    expect(presenceEnv(FLAG)).toBe(false);
  });

  // Realistic non-token values that presence-shaped community flags
  // ship with — these MUST read as truthy. Pre-fix on PR #647, these
  // went through `truthyEnv` and silently failed to suppress, narrowing
  // the established convention for NO_UPDATE_NOTIFIER and CI.
  it.each(["1", "true", "set", "enabled", "github", "  yes  ", "anything"])(
    "treats %s as truthy (any non-empty)",
    (v) => {
      process.env[FLAG] = v;
      expect(presenceEnv(FLAG)).toBe(true);
    },
  );

  it.each(["", "   ", "\t\n"])(
    "treats whitespace-only %j as falsy",
    (v) => {
      process.env[FLAG] = v;
      expect(presenceEnv(FLAG)).toBe(false);
    },
  );
});
