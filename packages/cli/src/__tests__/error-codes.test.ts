// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectFailure } from "./test-utils.js";

/**
 * The CLI must emit a structured JSON envelope on stderr when a command fails
 * under `--json`. Agents rely on the `code` field to decide whether to retry,
 * re-auth, or escalate — see docs/UX_GUIDE.md §12 and packages/core/src/errors/codes.ts.
 */
describe("error codes (JSON envelope)", () => {
  it("emits a parseable JSON object with a registry code on company-not-found", async () => {
    const result = await runCliExpectFailure([
      "clients",
      "show",
      "definitely-does-not-exist-at-all",
      "--json",
    ]);

    // The JSON envelope is the last well-formed JSON object on stderr —
    // strip any preamble lines (banners, demo notice) before parsing.
    const start = result.stderr.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const json = JSON.parse(result.stderr.slice(start));

    expect(json).toHaveProperty("code");
    expect(typeof json.code).toBe("string");
    expect(json.code).toMatch(/^ERROR_[A-Z_]+$/);
    // The specific failure here is a company lookup miss
    expect(json.code).toBe("ERROR_COMPANY_NOT_FOUND");
    expect(json).toHaveProperty("message");
    expect(typeof json.message).toBe("string");
  });
});
