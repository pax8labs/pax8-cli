// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// Mock CredentialStore so we can drive the "live + creds present" / "live + no
// creds" branches deterministically without touching the real keychain.
const getCredentialsMock = vi.fn();
vi.mock("@pax8/core", async (importActual) => {
  const actual = await importActual<typeof import("@pax8/core")>();
  return {
    ...actual,
    CredentialStore: class {
      getCredentials = getCredentialsMock;
    },
  };
});

import { authStatusCommand } from "./status.js";

/**
 * Build a tiny program with the same global flags as the real CLI so that
 * `command.optsWithGlobals()` resolves --json correctly.
 */
function makeProgram(): Command {
  const program = new Command()
    .name("pax8")
    .option("--json", "Output as JSON")
    .option("--csv", "Output as CSV")
    .option("--quiet", "Suppress all output")
    .exitOverride();
  const auth = new Command("auth").exitOverride();
  auth.addCommand(authStatusCommand);
  program.addCommand(auth);
  return program;
}

describe("auth status", () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  const originalIsTTY = process.stdout.isTTY;
  const originalDemo = process.env.PAX8_DEMO;

  beforeEach(() => {
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    getCredentialsMock.mockReset();
    // Default to TTY so the human path is the default unless we override
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
    });
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      writable: true,
    });
    if (originalDemo === undefined) {
      delete process.env.PAX8_DEMO;
    } else {
      process.env.PAX8_DEMO = originalDemo;
    }
  });

  function captured(): string {
    return stdoutWrite.mock.calls.map((c) => String(c[0])).join("");
  }

  it("emits JSON with credentialsPresent:true and mode:demo under --json + PAX8_DEMO=1", async () => {
    process.env.PAX8_DEMO = "1";
    await makeProgram().parseAsync(["node", "pax8", "auth", "status", "--json"]);
    const out = captured().trim();
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({ credentialsPresent: true, mode: "demo" });
  });

  it("emits human-formatted text in TTY mode without --json (demo)", async () => {
    process.env.PAX8_DEMO = "1";
    await makeProgram().parseAsync(["node", "pax8", "auth", "status"]);
    const out = captured();
    // Human output uses the checkmark + "demo mode" copy; no JSON braces.
    expect(out).toContain("demo mode");
    expect(out).not.toContain('"credentialsPresent"');
  });

  it("auto-emits JSON when stdout is non-TTY (agent-first contract)", async () => {
    process.env.PAX8_DEMO = "1";
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      writable: true,
    });
    await makeProgram().parseAsync(["node", "pax8", "auth", "status"]);
    const out = captured().trim();
    const parsed = JSON.parse(out);
    expect(parsed.credentialsPresent).toBe(true);
    expect(parsed.mode).toBe("demo");
  });

  it("emits credentialsPresent:true mode:live when creds are present (--json)", async () => {
    delete process.env.PAX8_DEMO;
    getCredentialsMock.mockResolvedValue({
      clientId: "abcdefghij1234567890",
      clientSecret: "secret-value",
    });
    await makeProgram().parseAsync(["node", "pax8", "auth", "status", "--json"]);
    const out = captured().trim();
    const parsed = JSON.parse(out);
    expect(parsed.credentialsPresent).toBe(true);
    expect(parsed.mode).toBe("live");
    // Mask should be present and must NOT include the full secret.
    expect(parsed.clientIdMasked).toBeDefined();
    expect(out).not.toContain("secret-value");
  });

  it("emits credentialsPresent:false mode:live when no creds are stored (--json)", async () => {
    delete process.env.PAX8_DEMO;
    getCredentialsMock.mockResolvedValue(null);
    await makeProgram().parseAsync(["node", "pax8", "auth", "status", "--json"]);
    const out = captured().trim();
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({ credentialsPresent: false, mode: "live" });
  });

  // #573: `auth status` only checks files on disk. The TTY human output for
  // the credentials-present branch must point the user at `pax8 doctor` for
  // an actual API-backed verification, so a user with rotated/revoked creds
  // doesn't take "credentials present" as a green light.
  it("hints at pax8 doctor when credentials are present (live, TTY)", async () => {
    delete process.env.PAX8_DEMO;
    getCredentialsMock.mockResolvedValue({
      clientId: "abcdefghij1234567890",
      clientSecret: "secret-value",
    });
    await makeProgram().parseAsync(["node", "pax8", "auth", "status"]);
    const out = captured();
    expect(out).toContain("pax8 doctor");
  });
});
