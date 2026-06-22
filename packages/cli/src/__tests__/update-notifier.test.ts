// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as pathJoin } from "node:path";
import { runCli, runCliExpectFailure } from "./test-utils.js";

/**
 * Subprocess tests for #183 — the update-notifier nudge surface.
 *
 * Tests use a pre-populated `<PAX8_CONFIG_DIR>/update-check.json` to
 * exercise the render path without touching the npm registry (and without
 * relying on `update-notifier`'s own configstore, which auto-disables
 * under `NODE_ENV=test`). The `PAX8_UPDATE_CHECK_TEST_FORCE=1` env var
 * is the documented test seam that bypasses the
 * non-TTY / NODE_ENV=test / CI auto-suppressors so the render-from-cache
 * path can run inside a piped subprocess. User-facing opt-outs
 * (`PAX8_NO_UPDATE_CHECK`, `PAX8_DEMO`, `--json`, `--quiet`) still win.
 */

const PKG_PATH = pathJoin(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "package.json",
);
const PKG_VERSION = JSON.parse(readFileSync(PKG_PATH, "utf-8")).version as string;
const NEWER_VERSION = "999.0.0";
const NUDGE_NEEDLE = "A new version of pax8-cli is available";

/**
 * Drop a "newer version available" record into the per-test cache dir so
 * `runUpdateCheck`'s render-from-cache stage has something to fire on.
 * Returns the cache path so individual tests can re-read it to assert
 * post-conditions (e.g. that `acknowledgedLatest` got stamped).
 */
function seedCache(configDir: string): string {
  fs.mkdirSync(configDir, { recursive: true });
  const cachePath = path.join(configDir, "update-check.json");
  fs.writeFileSync(
    cachePath,
    JSON.stringify(
      {
        latest: NEWER_VERSION,
        current: PKG_VERSION,
        type: "major",
        checkedAt: Date.now(),
      },
      null,
      2,
    ),
  );
  return cachePath;
}

describe("update-notifier nudge (#183)", () => {
  let configDir: string;
  let cachePath: string;

  beforeEach(() => {
    // Per-test PAX8_CONFIG_DIR isolation is provided by
    // `vitest.per-test-config-dir-setup.ts`. Capture it here so we can
    // also seed the cache file at the same path the subprocess will read.
    configDir = process.env.PAX8_CONFIG_DIR as string;
    expect(configDir).toBeTruthy();
    cachePath = seedCache(configDir);
  });

  it("prints the nudge to stderr (not stdout) when a newer version is cached", async () => {
    const result = await runCli(["version"], {
      PAX8_UPDATE_CHECK_TEST_FORCE: "1",
      // `version` is a local-only command (no API calls); turn demo mode
      // off so the PAX8_DEMO=1 suppression rule doesn't gate the banner.
      // The other suppression-signal tests below re-enable PAX8_DEMO to
      // assert the opt-out side.
      PAX8_DEMO: "",
    });
    expect(result.exitCode).toBe(0);
    // The banner goes to stderr — never stdout — so `pax8 … --json | jq`
    // pipelines stay clean.
    expect(result.stderr).toContain(NUDGE_NEEDLE);
    expect(result.stderr).toContain(NEWER_VERSION);
    expect(result.stdout).not.toContain(NUDGE_NEEDLE);
  });

  it("PAX8_NO_UPDATE_CHECK=1 suppresses the nudge even with the test-force seam", async () => {
    const result = await runCli(["version"], {
      PAX8_UPDATE_CHECK_TEST_FORCE: "1",
      PAX8_NO_UPDATE_CHECK: "1",
      PAX8_DEMO: "",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(NUDGE_NEEDLE);
    expect(result.stdout).not.toContain(NUDGE_NEEDLE);
  });

  it("PAX8_DEMO=1 suppresses the nudge (acceptance criterion)", async () => {
    // runCli already sets PAX8_DEMO=1 by default. We force the check
    // surface anyway, then assert the demo-mode opt-out still wins.
    const result = await runCli(["version"], {
      PAX8_UPDATE_CHECK_TEST_FORCE: "1",
      // PAX8_DEMO=1 is already set by runCli; this is explicit for the test.
      PAX8_DEMO: "1",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(NUDGE_NEEDLE);
  });

  it("--quiet suppresses the nudge", async () => {
    const result = await runCli(["--quiet", "version"], {
      PAX8_UPDATE_CHECK_TEST_FORCE: "1",
      PAX8_DEMO: "",
    });
    // version still exits 0 even under --quiet
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(NUDGE_NEEDLE);
  });

  it("PAX8_QUIET=1 suppresses the nudge", async () => {
    const result = await runCli(["version"], {
      PAX8_UPDATE_CHECK_TEST_FORCE: "1",
      PAX8_QUIET: "1",
      PAX8_DEMO: "",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(NUDGE_NEEDLE);
  });

  it("--json suppresses the nudge (never pollute a JSON stderr envelope)", async () => {
    const result = await runCli(["clients", "list", "--json", "--size", "1"], {
      PAX8_UPDATE_CHECK_TEST_FORCE: "1",
      // clients list requires the mock client (creds), so keep PAX8_DEMO=1.
      // The --json suppressor is what we're testing here, not the demo gate.
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(NUDGE_NEEDLE);
    expect(result.stdout).not.toContain(NUDGE_NEEDLE);
  });

  it("does NOT print without the test-force seam (subprocess stderr is not a TTY)", async () => {
    // Belt-and-suspenders: the non-TTY auto-suppressor must keep the
    // banner off the wire in normal subprocess use. This guards against
    // a future refactor that accidentally bypasses the stderr.isTTY check.
    const result = await runCli(["version"], { PAX8_DEMO: "" });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(NUDGE_NEEDLE);
  });

  it("stamps acknowledgedLatest after rendering so the next run stays quiet", async () => {
    const first = await runCli(["version"], {
      PAX8_UPDATE_CHECK_TEST_FORCE: "1",
      PAX8_DEMO: "",
    });
    expect(first.stderr).toContain(NUDGE_NEEDLE);

    // Verify the on-disk cache has acknowledgedLatest set to the version
    // we just rendered the banner for.
    const post = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as {
      acknowledgedLatest?: string;
      latest: string;
    };
    expect(post.acknowledgedLatest).toBe(post.latest);
    expect(post.acknowledgedLatest).toBe(NEWER_VERSION);

    // Second invocation should stay quiet — same `latest`, already acked.
    const second = await runCli(["version"], {
      PAX8_UPDATE_CHECK_TEST_FORCE: "1",
      PAX8_DEMO: "",
    });
    expect(second.stderr).not.toContain(NUDGE_NEEDLE);
  });

  // Regression for the operon-flagged P0 (round 2): the pre-fix gate
  // compared `acknowledgedAt >= checkedAt`, but `fillCacheFromUpdateNotifier`
  // bumps `checkedAt` on every daily refresh even when `latest` is
  // unchanged. The invariant flipped on every cycle and the banner
  // re-fired. Simulate that exact scenario: write a cache file where
  // a prior session DID ack the `latest` (acknowledgedLatest === latest),
  // then advance `checkedAt` to "now" as if a fresh refresh just ran
  // without finding a newer release. The banner must stay quiet.
  it("stays quiet across a simulated daily refresh that doesn't change `latest`", async () => {
    // Pre-populate with the post-ack shape, then mimic what
    // fillCacheFromUpdateNotifier would write on day 2: same `latest`,
    // bumped `checkedAt`, preserved `acknowledgedLatest`.
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        latest: NEWER_VERSION,
        current: PKG_VERSION,
        type: "major",
        checkedAt: Date.now(),
        acknowledgedLatest: NEWER_VERSION,
      }),
    );
    const result = await runCli(["version"], {
      PAX8_UPDATE_CHECK_TEST_FORCE: "1",
      PAX8_DEMO: "",
    });
    expect(result.stderr).not.toContain(NUDGE_NEEDLE);
  });

  // The flip side: when `latest` advances (a newer release lands), the
  // banner DOES re-fire even though there's a prior ack on disk.
  it("re-fires the banner when a newer `latest` lands in the cache", async () => {
    const NEWER_STILL = "1000.0.0";
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        latest: NEWER_STILL,
        current: PKG_VERSION,
        type: "major",
        checkedAt: Date.now(),
        // Ack was for the OLDER `latest`; the new one hasn't been seen.
        acknowledgedLatest: NEWER_VERSION,
      }),
    );
    const result = await runCli(["version"], {
      PAX8_UPDATE_CHECK_TEST_FORCE: "1",
      PAX8_DEMO: "",
    });
    expect(result.stderr).toContain(NUDGE_NEEDLE);
    expect(result.stderr).toContain(NEWER_STILL);
  });
});

describe("ERROR_API_VALIDATION drift-aware hint (#183)", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = process.env.PAX8_CONFIG_DIR as string;
    expect(configDir).toBeTruthy();
    seedCache(configDir);
  });

  it("appends the upgrade hint to recoverySteps in the --json envelope", async () => {
    // `subscriptions update --quantity <decrease> --yes --json` throws
    // a `CliError` with `code: ERROR_API_VALIDATION` (the commitment
    // pre-flight guard — see subscriptions.test.ts:466). With our
    // update-check cache pre-populated, that recoverySteps array should
    // now lead with the "newer pax8-cli available" hint.
    const result = await runCliExpectFailure([
      "subscriptions",
      "update",
      "sub-summit-m365bp-001",
      "--quantity",
      "5",
      "--yes",
      "--json",
    ]);
    expect(result.stderr).toContain("ERROR_API_VALIDATION");
    expect(result.stderr).toContain(NEWER_VERSION);
    expect(result.stderr).toContain("A newer version of pax8-cli");
  });

  it("appends the upgrade hint to the human-readable recovery steps", async () => {
    const result = await runCliExpectFailure([
      "subscriptions",
      "update",
      "sub-summit-m365bp-001",
      "--quantity",
      "5",
      "--yes",
    ]);
    expect(result.stderr).toContain("A newer version of pax8-cli");
    expect(result.stderr).toContain(NEWER_VERSION);
  });

  it("omits the hint when no newer version is cached", async () => {
    // Overwrite the seeded cache with a record where `latest === current`
    // — `readCachedUpdateInfo` then drops the record (it's no longer a
    // "newer version available" signal).
    fs.writeFileSync(
      path.join(configDir, "update-check.json"),
      JSON.stringify({
        latest: PKG_VERSION,
        current: PKG_VERSION,
        type: "latest",
        checkedAt: Date.now(),
      }),
    );
    const result = await runCliExpectFailure([
      "subscriptions",
      "update",
      "sub-summit-m365bp-001",
      "--quantity",
      "5",
      "--yes",
      "--json",
    ]);
    expect(result.stderr).toContain("ERROR_API_VALIDATION");
    expect(result.stderr).not.toContain("A newer version of pax8-cli");
  });
});
