// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as pathJoin } from "node:path";
import { runCliExpectSuccess } from "./test-utils.js";

// Read the @pax8/cli package version dynamically so this test doesn't
// silently break every time changesets bumps the version. Previously
// hardcoded as "0.1.0"; the bump to 0.2.0 in #276 broke main CI because
// the changesets release PR didn't run CI to catch this.
const PKG_PATH = pathJoin(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "package.json",
);
const PKG_VERSION = JSON.parse(readFileSync(PKG_PATH, "utf-8")).version as string;

describe("pax8 version", () => {
  it("prints version number", async () => {
    const result = await runCliExpectSuccess(["version"]);
    expect(result.stdout).toContain("pax8-cli");
    expect(result.stdout).toContain(PKG_VERSION);
  });

  it("prints node version", async () => {
    const result = await runCliExpectSuccess(["version"]);
    expect(result.stdout).toContain("node");
    expect(result.stdout).toMatch(/v\d+\.\d+\.\d+/);
  });

  it("prints platform", async () => {
    const result = await runCliExpectSuccess(["version"]);
    expect(result.stdout).toContain("platform");
  });
});
