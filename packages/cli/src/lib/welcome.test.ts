// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { showWelcomeScreen } from "./welcome.js";

// Mock the @pax8/core CredentialStore so the test doesn't depend on a real
// ~/.pax8/credentials.json on the runner. We assert against both branches
// by toggling hasCredentials() per test. vi.hoisted is needed because
// vi.mock factory bodies are hoisted above other top-level statements.
const mockState = vi.hoisted(() => ({
  hasCredentials: vi.fn<[], Promise<boolean>>(),
  shouldThrow: false,
}));
vi.mock("@pax8/core", () => ({
  CredentialStore: class {
    async hasCredentials(): Promise<boolean> {
      if (mockState.shouldThrow) throw new Error("boom");
      return mockState.hasCredentials();
    }
  },
}));

describe("showWelcomeScreen", () => {
  const originalEnv = { ...process.env };
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let captured: string;

  beforeEach(() => {
    captured = "";
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
        return true;
      });
    // Start with a clean env each test so PAX8_DEMO etc. doesn't leak.
    process.env = { ...originalEnv };
    delete process.env.PAX8_DEMO;
    delete process.env.PAX8_CLIENT_ID;
    delete process.env.PAX8_CLIENT_SECRET;
    mockState.hasCredentials.mockReset();
    mockState.shouldThrow = false;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    process.env = originalEnv;
  });

  it("renders the unauthenticated layout when no credentials are configured", async () => {
    mockState.hasCredentials.mockResolvedValueOnce(false);

    await showWelcomeScreen();

    expect(captured).toContain("Try it:");
    expect(captured).toContain("init --demo");
    expect(captured).toContain("auth login");
    expect(captured).toContain("Stuck?");
    expect(captured).toContain("doctor");
    expect(captured).toContain("Sample data, no auth required");
    expect(captured).toContain("Connect your Pax8 partner account");

    // The authenticated-only command headings/items must NOT appear.
    // Note: "recommendations" appears in the value-prop blurb ("upsell
    // recommendations"), so we anchor on the command-block markers
    // instead of the bare word.
    expect(captured).not.toContain("Common commands:");
    expect(captured).not.toContain("subscriptions renewals");
    expect(captured).not.toContain("invoices audit");
    expect(captured).not.toContain("Portfolio at a glance");
    expect(captured).not.toContain("doctor for setup checks");

    // Value-prop blurb is present and PAX8 art is preserved.
    expect(captured).toContain("Pax8 CLI turns the marketplace API");
    expect(captured).toContain("renewals, invoice audits, MRR");
    expect(captured).toContain("██████╗");
  });

  it("renders the authenticated layout when credentials are configured", async () => {
    mockState.hasCredentials.mockResolvedValueOnce(true);

    await showWelcomeScreen();

    expect(captured).toContain("Common commands:");
    expect(captured).toContain("status");
    expect(captured).toContain("subscriptions renewals");
    expect(captured).toContain("recommendations");
    expect(captured).toContain("invoices audit");
    expect(captured).toContain("Portfolio at a glance");
    expect(captured).toContain("doctor for setup checks");

    // The unauthenticated-only sections must NOT appear.
    expect(captured).not.toContain("Try it:");
    expect(captured).not.toContain("Stuck?");
    expect(captured).not.toContain("Sample data, no auth required");
    expect(captured).not.toContain("Connect your Pax8 partner account");

    expect(captured).toContain("Pax8 CLI turns the marketplace API");
  });

  it("treats PAX8_DEMO=1 as authenticated without consulting CredentialStore", async () => {
    process.env.PAX8_DEMO = "1";
    // hasCredentials is intentionally NOT primed — the demo short-circuit
    // should mean it is never called.

    await showWelcomeScreen();

    expect(mockState.hasCredentials).not.toHaveBeenCalled();
    expect(captured).toContain("Common commands:");
    expect(captured).toContain("subscriptions renewals");
  });

  it("falls back to the unauthenticated layout if the credential check throws", async () => {
    mockState.shouldThrow = true;

    await showWelcomeScreen();

    expect(captured).toContain("Try it:");
    expect(captured).toContain("init --demo");
    expect(captured).not.toContain("Common commands:");
  });
});
