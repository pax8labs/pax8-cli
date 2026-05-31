// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runCliExpectSuccess } from "./test-utils.js";

// #395: subprocess coverage for the five commands that previously had no
// (or only minimal) test references — `init`, `completions`, the three
// easter eggs (`coffee`, `moo`), plus the existing `report-bug.test.ts`
// surface that's already thoroughly covered. Each test here is a smoke
// assertion: command exits 0, emits the expected shape on stdout, doesn't
// crash. Per the issue's acceptance criteria — minimal coverage is the
// bar, not exhaustive contract pinning.

describe("pax8 init", () => {
  // Each test gets a unique config-dir so concurrent runs don't collide
  // and we don't pollute the host's real ~/.pax8.
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-init-test-"));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("--help describes the init command", async () => {
    const result = await runCliExpectSuccess(["init", "--help"]);
    expect(result.stdout).toContain("Initialize configuration");
    expect(result.stdout).toContain("--demo");
    expect(result.stdout).toContain("--force");
    expect(result.stdout).toContain("Examples:");
  });

  it("creates a default config when none exists", async () => {
    const result = await runCliExpectSuccess(["init"], {
      PAX8_CONFIG_DIR: tmpDir,
    });
    // Either a "config written" success message or the file shows up on disk —
    // assert the file is what matters (downstream commands read it, not the
    // human text).
    const configPath = path.join(tmpDir, "config.yaml");
    const stat = await fs.stat(configPath);
    expect(stat.isFile()).toBe(true);
    // Side-effect message goes to stdout (init is informational).
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("--demo enables persistent demo mode", async () => {
    await runCliExpectSuccess(["init", "--demo"], {
      PAX8_CONFIG_DIR: tmpDir,
    });
    const config = await fs.readFile(path.join(tmpDir, "config.yaml"), "utf-8");
    expect(config).toMatch(/demo:\s*true/);
  });

  it("--demo off disables persistent demo mode", async () => {
    // Enable first, then disable — verifies the toggle in both directions.
    await runCliExpectSuccess(["init", "--demo"], {
      PAX8_CONFIG_DIR: tmpDir,
    });
    await runCliExpectSuccess(["init", "--demo", "off"], {
      PAX8_CONFIG_DIR: tmpDir,
    });
    const config = await fs.readFile(path.join(tmpDir, "config.yaml"), "utf-8");
    expect(config).toMatch(/demo:\s*false/);
  });
});

describe("pax8 completions", () => {
  it("emits valid bash completion script for `bash`", async () => {
    const result = await runCliExpectSuccess(["completions", "bash"]);
    // The completion script must define the bash function commander expects,
    // and the `complete -F` registration line.
    expect(result.stdout).toContain("_pax8_completions");
    expect(result.stdout).toContain("complete -F _pax8_completions pax8");
    // Should also enumerate at least the top-level commands; absence would
    // mean a future refactor silently dropped the catalog.
    expect(result.stdout).toContain("clients");
    expect(result.stdout).toContain("subscriptions");
  });

  it("emits zsh completion when asked", async () => {
    const result = await runCliExpectSuccess(["completions", "zsh"]);
    // The zsh script should reference compdef and the same top-level catalog.
    expect(result.stdout.length).toBeGreaterThan(0);
    // Don't pin the exact shape — different shells have different syntax;
    // smoke check that we got non-empty output for the requested shell.
  });

  it("--help describes the completions command", async () => {
    const result = await runCliExpectSuccess(["completions", "--help"]);
    expect(result.stdout).toContain("completion");
  });
});

describe("pax8 easter eggs", () => {
  // `coffee` simulates a progress bar with sleeps; the full run is ~6 seconds.
  // We bump the timeout per-test rather than globally so the rest of the
  // smoke suite stays fast.
  it(
    "coffee renders the progress bar and the final ready-message",
    async () => {
      const result = await runCliExpectSuccess(["coffee"]);
      // The terminal-control bytes (\r) and the progress glyphs are platform-
      // varying; assert the stable end-state instead — partners always see the
      // "ready" line + the coffee emoji.
      expect(result.stdout).toContain("Your coffee is ready");
    },
    15_000,
  );

  it("moo renders the ASCII cow + a quote", async () => {
    const result = await runCliExpectSuccess(["moo"]);
    // The cow ASCII includes `(oo)` — that's the unambiguous fingerprint
    // a future refactor that broke the rendering would miss.
    expect(result.stdout).toContain("(oo)");
    // The quote line is wrapped in double quotes around random fortune text.
    expect(result.stdout).toMatch(/"[^"]+"/);
  });
});
