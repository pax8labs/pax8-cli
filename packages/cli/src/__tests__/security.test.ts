// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * End-to-end smoke for the trust-sensitive env var guards (#234, #262).
 *
 * Verifies the validators work through the real CLI binary — i.e. a user
 * invoking `pax8 ...` with a poisoned env actually sees the security
 * error and a non-zero exit, rather than silently sending requests to an
 * attacker-controlled host or writing into an arbitrary path.
 *
 * Lives in the cli package (alongside the other __tests__/) because it
 * needs `runCli` to spawn the built binary; the unit-level coverage of
 * `validateBaseUrl` / `validateConfigDir` lives in
 * packages/core/src/api/client.test.ts and
 * packages/core/src/config/loader-extended.test.ts.
 */

import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

describe("security: PAX8_API_BASE (#234)", () => {
  it("exits non-zero when PAX8_API_BASE is a plaintext non-loopback http URL", async () => {
    const result = await runCli(["status"], {
      PAX8_API_BASE: "http://attacker.example.com",
      // Cancel out the global vitest opt-in so the strict default kicks in.
      PAX8_ALLOW_INSECURE_BASE: "",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Refusing to use plaintext http/i);
    expect(result.stderr).toContain("PAX8_ALLOW_INSECURE_BASE");
  });

  it("accepts http://localhost (loopback dev path)", async () => {
    // We don't actually expect status to succeed against localhost:8080
    // (nothing is listening), but the security guard must let it past.
    // In demo mode the CLI doesn't make a network call, so this passes.
    const result = await runCliExpectSuccess(["status"], {
      PAX8_API_BASE: "http://localhost:8080",
    });
    // Smoke: the URL was accepted and the command ran.
    expect(result.stdout.length + result.stderr.length).toBeGreaterThan(0);
  });

  it("accepts a malicious http URL when PAX8_ALLOW_INSECURE_BASE=1 (escape hatch)", async () => {
    const result = await runCliExpectSuccess(["status"], {
      PAX8_API_BASE: "http://test-rig.internal",
      PAX8_ALLOW_INSECURE_BASE: "1",
    });
    // The loud red warning should land on stderr.
    expect(result.stderr).toMatch(/WARNING/i);
    expect(result.stderr).toContain("test-rig.internal");
  });
});

describe("security: PAX8_CONFIG_DIR (#262)", () => {
  it("exits non-zero when PAX8_CONFIG_DIR resolves outside $HOME without opt-out", async () => {
    const result = await runCli(["auth", "status"], {
      PAX8_CONFIG_DIR: "/tmp/test-pax8-outside-home",
      // Cancel out the global vitest opt-in so the strict default kicks in.
      PAX8_ALLOW_NON_HOME_CONFIG: "",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Refusing to use config directory outside/i);
    expect(result.stderr).toContain("PAX8_ALLOW_NON_HOME_CONFIG");
  });

  it("accepts PAX8_CONFIG_DIR=/tmp/... when PAX8_ALLOW_NON_HOME_CONFIG=1", async () => {
    const tmp = path.join(
      os.tmpdir(),
      `pax8-security-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const result = await runCliExpectSuccess(["auth", "status"], {
      PAX8_CONFIG_DIR: tmp,
      PAX8_ALLOW_NON_HOME_CONFIG: "1",
    });
    // Smoke: the command ran without the security error.
    expect(result.stderr).not.toMatch(/Refusing to use config directory/i);
  });

  it("accepts a path under $HOME without the opt-out", async () => {
    // Use a path under $HOME we'd never collide with.
    const inside = path.join(
      os.homedir(),
      `.pax8-security-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const result = await runCliExpectSuccess(["auth", "status"], {
      PAX8_CONFIG_DIR: inside,
      PAX8_ALLOW_NON_HOME_CONFIG: "",
    });
    expect(result.stderr).not.toMatch(/Refusing to use config directory/i);
  });
});
