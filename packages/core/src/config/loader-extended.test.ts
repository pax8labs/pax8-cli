// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { getConfigDir, ensureConfigDir } from "./loader.js";
import * as path from "node:path";
import * as os from "node:os";

describe("config/loader — extended coverage", () => {
  it("getConfigDir returns path under home directory", () => {
    const dir = getConfigDir();
    expect(dir).toBe(path.join(os.homedir(), ".pax8"));
  });

  it("ensureConfigDir creates and returns config dir", async () => {
    const dir = await ensureConfigDir();
    expect(dir).toBe(path.join(os.homedir(), ".pax8"));
  });
});
