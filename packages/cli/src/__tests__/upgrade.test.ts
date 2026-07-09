// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as pathJoin } from "node:path";
import { runCli, runCliExpectFailure } from "./test-utils.js";

/**
 * Subprocess tests for `pax8 upgrade` (install-method-aware self-updater).
 *
 * runCli() runs the built CLI with PAX8_DEMO=1, so the network lookup and
 * the real package-manager spawn are both skipped by design — demo mode is
 * hermetic. We drive the version comparison via the `PAX8_UPGRADE_LATEST`
 * seam and pin the reported install method via `PAX8_UPGRADE_METHOD` so the
 * JSON envelope is byte-stable regardless of where the built CLI lives.
 */

const PKG_PATH = pathJoin(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "package.json",
);
const PKG_VERSION = JSON.parse(readFileSync(PKG_PATH, "utf-8")).version as string;
const NEWER = "999.0.0";

describe("pax8 upgrade", () => {
  it("reports up-to-date when latest equals current (--json)", async () => {
    const { stdout, exitCode } = await runCli(["upgrade", "--check", "--json"], {
      PAX8_UPGRADE_LATEST: PKG_VERSION,
      PAX8_UPGRADE_METHOD: "npm-global",
    });
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.current).toBe(PKG_VERSION);
    expect(out.latest).toBe(PKG_VERSION);
    expect(out.upToDate).toBe(true);
    expect(out.action).toBe("up-to-date");
  });

  it("reports a newer version under --check without installing (--json)", async () => {
    const { stdout, exitCode } = await runCli(["upgrade", "--check", "--json"], {
      PAX8_UPGRADE_LATEST: NEWER,
      PAX8_UPGRADE_METHOD: "npm-global",
    });
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.upToDate).toBe(false);
    expect(out.latest).toBe(NEWER);
    expect(out.action).toBe("checked");
    expect(out.installMethod).toBe("npm-global");
    expect(out.upgradeArgs).toEqual(["npm", "i", "-g", "@pax8/cli@latest"]);
  });

  it("tailors the upgrade command to the install method (pnpm)", async () => {
    const { stdout } = await runCli(["upgrade", "--check", "--json"], {
      PAX8_UPGRADE_LATEST: NEWER,
      PAX8_UPGRADE_METHOD: "pnpm-global",
    });
    const out = JSON.parse(stdout);
    expect(out.manager).toBe("pnpm");
    expect(out.upgradeCommand).toBe("pnpm add -g @pax8/cli@latest");
    expect(out.upgradeArgs).toEqual(["pnpm", "add", "-g", "@pax8/cli@latest"]);
  });

  it("emits action=manual and no argv for an npx install", async () => {
    const { stdout } = await runCli(["upgrade", "--json"], {
      PAX8_UPGRADE_LATEST: NEWER,
      PAX8_UPGRADE_METHOD: "npx",
    });
    const out = JSON.parse(stdout);
    expect(out.action).toBe("manual");
    expect(out.upgradeArgs).toBeNull();
  });

  it("skips the real install under demo mode with -y (action=skipped)", async () => {
    const { stdout } = await runCli(["upgrade", "-y", "--json"], {
      PAX8_UPGRADE_LATEST: NEWER,
      PAX8_UPGRADE_METHOD: "npm-global",
    });
    const out = JSON.parse(stdout);
    // Demo mode must never shell out to a real package manager.
    expect(out.action).toBe("skipped");
    expect(out.upgradeArgs).toEqual(["npm", "i", "-g", "@pax8/cli@latest"]);
  });

  it("non-TTY without --yes errors cleanly instead of silently installing", async () => {
    // A newer version is available, npm-global is auto-runnable, and there's
    // no -y — so this hits the confirm-and-install path. Subprocesses spawned
    // by execFile have a non-TTY stdin by default, so this exercises the
    // production guard that would otherwise let confirm()'s EOF default
    // silently proceed to run the package manager.
    const { stderr, exitCode } = await runCliExpectFailure(["upgrade"], {
      PAX8_UPGRADE_LATEST: NEWER,
      PAX8_UPGRADE_METHOD: "npm-global",
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/TTY/i);
    expect(stderr).toMatch(/--yes|-y/);
  });

  it("renders a human-readable report in table mode", async () => {
    const { stdout } = await runCli(["upgrade", "--check"], {
      PAX8_UPGRADE_LATEST: NEWER,
      PAX8_UPGRADE_METHOD: "npm-global",
      PAX8_OUTPUT_FORMAT: "table",
    });
    expect(stdout).toContain("A new version of pax8-cli is available");
    expect(stdout).toContain(NEWER);
    expect(stdout).toContain("npm i -g @pax8/cli@latest");
  });

  it("errors with ERROR_API_TIMEOUT when the latest version can't be determined", async () => {
    // The `unknown` sentinel forces the "can't determine latest" path
    // deterministically (demo mode itself is benign — it reports up-to-date).
    const { stderr } = await runCliExpectFailure(["upgrade", "--json"], {
      PAX8_UPGRADE_METHOD: "npm-global",
      PAX8_UPGRADE_LATEST: "unknown",
    });
    // Demo mode prints a banner to stderr before the JSON envelope, so slice
    // from the first brace rather than parsing stderr directly.
    const err = JSON.parse(stderr.slice(stderr.indexOf("{")));
    expect(err.code).toBe("ERROR_API_TIMEOUT");
  });
});
