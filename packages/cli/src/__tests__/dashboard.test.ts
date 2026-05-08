// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

const DEPRECATION_NOTICE =
  "warning: `status` is deprecated; use `dashboard`. Will be removed in v1.0.";

describe("pax8 dashboard (canonical)", () => {
  it("--json returns the portfolio snapshot under the new name", async () => {
    const result = await runCliExpectSuccess(["dashboard", "--json"]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("totalCompanies");
    expect(data).toHaveProperty("activeSubscriptions");
    expect(data).toHaveProperty("mrr");
    // Deprecation notice MUST NOT fire for the canonical name.
    expect(result.stderr).not.toContain(DEPRECATION_NOTICE);
  });

  it("--help mentions the dashboard command name", async () => {
    const result = await runCliExpectSuccess(["dashboard", "--help"]);
    expect(result.stdout).toContain("dashboard");
    expect(result.stdout.toLowerCase()).toContain("snapshot");
    expect(result.stderr).not.toContain(DEPRECATION_NOTICE);
  });

  it("is listed in `pax8 --help` (canonical command surfaces in top-level help)", async () => {
    const result = await runCliExpectSuccess(["--help"]);
    expect(result.stdout).toContain("dashboard");
  });
});

describe("pax8 status (deprecated alias)", () => {
  it("--json returns the same payload shape as `pax8 dashboard --json`", async () => {
    const dash = await runCliExpectSuccess(["dashboard", "--json"]);
    const status = await runCliExpectSuccess(["status", "--json"]);

    const dashData = JSON.parse(dash.stdout);
    const statusData = JSON.parse(status.stdout);

    // Same keys → same surface (values may drift across calls if the demo
    // mock is non-deterministic, but the contract is identical).
    expect(Object.keys(statusData).sort()).toEqual(Object.keys(dashData).sort());
    expect(statusData).toHaveProperty("totalCompanies");
    expect(statusData).toHaveProperty("activeSubscriptions");
  });

  it("emits the one-line deprecation notice on stderr", async () => {
    const result = await runCliExpectSuccess(["status", "--json"]);
    expect(result.stderr).toContain(DEPRECATION_NOTICE);
    // Stderr-only — never leaks into the JSON payload that consumers parse.
    expect(result.stdout).not.toContain(DEPRECATION_NOTICE);
  });

  it("is hidden from `pax8 --help` (still works, but not advertised)", async () => {
    const result = await runCliExpectSuccess(["--help"]);
    // The legacy alias must not appear as its own line in the top-level
    // command list. (The substring "status" still occurs inside other
    // help phrases — e.g. `--status <status>` filter examples — so we
    // assert on the leading-whitespace-then-"status" command-listing
    // shape Commander uses, which would only be present if the alias
    // were *not* hidden.)
    expect(result.stdout).not.toMatch(/^\s+status\b/m);
  });

  it("--help still works on the alias and emits the deprecation notice on stderr", async () => {
    const result = await runCliExpectSuccess(["status", "--help"]);
    // The alias --help can render either the dashboard help or the alias's
    // own help; either is acceptable. What matters is that invoking the
    // alias still surfaces the deprecation notice.
    expect(result.stderr).toContain(DEPRECATION_NOTICE);
  });
});
