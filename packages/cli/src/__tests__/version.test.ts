// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("pax8 version", () => {
  it("prints version number", async () => {
    const result = await runCliExpectSuccess(["version"]);
    expect(result.stdout).toContain("pax8-cli");
    // Match any semver-shaped string instead of pinning a specific version
    // — `chore: release` bumps the package version regularly and the test
    // shouldn't break every release.
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
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
