// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

describe("E2E: Onboarding — first-time user experience", () => {
  it("pax8 doctor reports checks (Node version, config, etc.)", async () => {
    const result = await runCliExpectSuccess(["doctor"]);
    expect(result.stdout).toContain("Node.js version");
    expect(result.stdout).toContain("Diagnostics");
  });

  it("pax8 auth login --client-id demo --client-secret demo succeeds in demo mode", async () => {
    const result = await runCliExpectSuccess([
      "auth",
      "login",
      "--client-id",
      "demo",
      "--client-secret",
      "demo",
    ]);
    // Subprocess stdout is non-TTY, so the agent-first contract auto-emits
    // JSON (#210) — same pattern as the `auth status` assertion below. The
    // human-mode "✓ Authenticated (demo mode)" banner is now stderr-only
    // (#471) and never reaches a subprocess stdout consumer.
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("authenticated");
    expect(parsed.mode).toBe("demo");
  });

  it("pax8 auth status shows auth info", async () => {
    // Subprocess stdout is non-TTY, so the agent-first contract auto-emits
    // JSON (#210). We assert on the structured shape rather than human copy.
    // Field renamed from `authenticated` to `credentialsPresent` in #573 —
    // `auth status` only checks files on disk, never hits /v1/token.
    const result = await runCliExpectSuccess(["auth", "status"]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.credentialsPresent).toBe(true);
    expect(parsed.mode).toBe("demo");
  });

  it("pax8 clients list shows demo companies", async () => {
    const result = await runCliExpectSuccess(["clients", "list"]);
    // In non-TTY, default output is JSON. #483: wrapped as { companies, page }.
    expect(result.stdout.length).toBeGreaterThan(0);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.companies)).toBe(true);
    expect(data.companies.length).toBeGreaterThan(0);
    expect(data.companies[0]).toHaveProperty("name");
  });

  it("pax8 clients list --json produces valid { companies, page } envelope", async () => {
    const result = await runCliExpectSuccess(["clients", "list", "--json"]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("companies");
    expect(data).toHaveProperty("page");
    expect(Array.isArray(data.companies)).toBe(true);
    expect(data.companies.length).toBeGreaterThan(0);
    expect(data.companies[0]).toHaveProperty("id");
    expect(data.companies[0]).toHaveProperty("name");
    expect(data.companies[0]).toHaveProperty("status");
  });
});
