// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runCli, runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

const COMPANY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PRODUCT_ID = "prod-m365-biz-prem-0001";

describe("--idempotency-key", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-idem-it-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("first call hits the API; second call replays from cache", async () => {
    const key = "9f3b2c1e-7d4f-4a8b-9c2d-1e2f3a4b5c6d";

    const first = await runCliExpectSuccess(
      [
        "orders", "create",
        "--company", COMPANY_ID,
        "--product", PRODUCT_ID,
        "--quantity", "5",
        "--billing-term", "Monthly",
        "--yes",
        "--json",
        "--idempotency-key", key,
      ],
      { PAX8_IDEMPOTENCY_DIR: tmpDir },
    );

    expect(first.stderr).not.toContain("idempotent replay");
    const firstJson = JSON.parse(first.stdout);
    expect(firstJson).toHaveProperty("id");

    // Cache file should exist
    const files = await fs.readdir(tmpDir);
    expect(files.filter((f) => f.endsWith(".json")).length).toBe(1);

    const second = await runCliExpectSuccess(
      [
        "orders", "create",
        "--company", COMPANY_ID,
        "--product", PRODUCT_ID,
        "--quantity", "5",
        "--billing-term", "Monthly",
        "--yes",
        "--json",
        "--idempotency-key", key,
      ],
      { PAX8_IDEMPOTENCY_DIR: tmpDir },
    );

    expect(second.stderr).toContain("idempotent replay");
    // Replay should produce byte-for-byte identical stdout (the cached payload).
    expect(second.stdout).toBe(first.stdout);
  });

  it("rejects same key with different args", async () => {
    const key = "abc12345-1234-4abc-8def-0123456789ab";

    await runCliExpectSuccess(
      [
        "orders", "create",
        "--company", COMPANY_ID,
        "--product", PRODUCT_ID,
        "--quantity", "5",
        "--yes", "--json",
        "--idempotency-key", key,
      ],
      { PAX8_IDEMPOTENCY_DIR: tmpDir },
    );

    const second = await runCliExpectFailure(
      [
        "orders", "create",
        "--company", COMPANY_ID,
        "--product", PRODUCT_ID,
        "--quantity", "10",         // different quantity
        "--yes", "--json",
        "--idempotency-key", key,
      ],
      { PAX8_IDEMPOTENCY_DIR: tmpDir },
    );

    expect(second.stderr).toMatch(/[Ii]dempotency key reused with different arguments/);
  });

  it("rejects an invalid key", async () => {
    const result = await runCliExpectFailure(
      [
        "orders", "create",
        "--company", COMPANY_ID,
        "--product", PRODUCT_ID,
        "--yes", "--json",
        "--idempotency-key", "bad key!", // contains space and bang
      ],
      { PAX8_IDEMPOTENCY_DIR: tmpDir },
    );
    expect(result.stderr).toMatch(/[Ii]nvalid idempotency key/);
  });

  it("works in demo mode (caches locally)", async () => {
    // Default test env already has PAX8_DEMO=1; this asserts the flag is honored
    // even with the mock client.
    const key = "demomode-1234-4abc-8def-0123456789ab";
    const first = await runCliExpectSuccess(
      [
        "orders", "create",
        "--company", COMPANY_ID,
        "--product", PRODUCT_ID,
        "--quantity", "3",
        "--yes", "--json",
        "--idempotency-key", key,
      ],
      { PAX8_IDEMPOTENCY_DIR: tmpDir, PAX8_DEMO: "1" },
    );
    const second = await runCliExpectSuccess(
      [
        "orders", "create",
        "--company", COMPANY_ID,
        "--product", PRODUCT_ID,
        "--quantity", "3",
        "--yes", "--json",
        "--idempotency-key", key,
      ],
      { PAX8_IDEMPOTENCY_DIR: tmpDir, PAX8_DEMO: "1" },
    );
    expect(second.stderr).toContain("idempotent replay");
    expect(second.stdout).toBe(first.stdout);
  });

  it("read commands do not accept --idempotency-key", async () => {
    const result = await runCli(
      ["clients", "list", "--idempotency-key", "abc12345-1234-4abc-8def-0123456789ab"],
    );
    // Commander prints "unknown option" to stderr and exits non-zero.
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/unknown option|--idempotency-key/);
  });

  it("--help mentions --idempotency-key on writes", async () => {
    const result = await runCliExpectSuccess(["orders", "create", "--help"]);
    expect(result.stdout).toContain("--idempotency-key");
    expect(result.stdout).toContain("24h TTL");
  });

  it("--help on a read command does not mention --idempotency-key", async () => {
    const result = await runCliExpectSuccess(["clients", "list", "--help"]);
    expect(result.stdout).not.toContain("--idempotency-key");
  });
});

// #M-5: PAX8_IDEMPOTENCY_DIR sidestepped the home-dir guard that already
// applies to PAX8_CONFIG_DIR. A CI/sandboxed environment that controls this
// env var could point it anywhere — `/etc/...`, a sibling user's home, etc.
// Route both that var and PAX8_DISPUTES_DIR through `validateConfigDir()` so
// the same allow-list semantics apply uniformly.
describe("PAX8_IDEMPOTENCY_DIR home-dir guard (#M-5)", () => {
  const NON_HOME_PATH = "/tmp/pax8-m5-guard-test";
  const KEY = "9f3b2c1e-7d4f-4a8b-9c2d-1e2f3a4b5c6d";
  // Use a fresh in-$HOME dir per test run so we don't pollute the
  // contributor's home and so afterAll can clean up cleanly. This sidesteps
  // the test-isolation setup's tmpdir (which is under /var/folders and
  // would itself trip the home-dir guard when we unset the opt-out).
  let inHomeConfigDir: string;
  beforeEach(async () => {
    inHomeConfigDir = await fs.mkdtemp(path.join(os.homedir(), ".pax8-m5-cfg-"));
  });
  afterEach(async () => {
    await fs.rm(inHomeConfigDir, { recursive: true, force: true });
  });

  it("rejects non-home PAX8_IDEMPOTENCY_DIR without PAX8_ALLOW_NON_HOME_CONFIG", async () => {
    // Default test env sets PAX8_ALLOW_NON_HOME_CONFIG=1 globally
    // (vitest.config.ts). To exercise the guard we have to *unset* it for
    // this single subprocess. runCli's env-merge means setting it to ""
    // doesn't unset, so we pass an explicit override; the guard treats
    // anything not literally "1" as opt-out.
    //
    // We also point PAX8_CONFIG_DIR at a sub-path of $HOME so the *outer*
    // config-dir guard (which would otherwise see the vitest-injected
    // tmpdir under /var/folders) passes, leaving only the
    // PAX8_IDEMPOTENCY_DIR guard to trip. Without this, the parent
    // PAX8_CONFIG_DIR=/var/folders/... fails first and we measure the
    // wrong thing.
    const result = await runCliExpectFailure(
      [
        "orders", "create",
        "--company", COMPANY_ID,
        "--product", PRODUCT_ID,
        "--quantity", "5",
        "--yes", "--json",
        "--idempotency-key", KEY,
      ],
      {
        PAX8_CONFIG_DIR: inHomeConfigDir,
        PAX8_IDEMPOTENCY_DIR: NON_HOME_PATH,
        PAX8_ALLOW_NON_HOME_CONFIG: "",
      },
    );
    expect(result.stderr).toMatch(/Refusing to use config directory outside of \$HOME/i);
    const envelope = JSON.parse(extractJsonEnvelope(result.stderr));
    expect(envelope.code).toBe("ERROR_INVALID_INPUT");
  });

  it("accepts non-home PAX8_IDEMPOTENCY_DIR when PAX8_ALLOW_NON_HOME_CONFIG=1", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-m5-allow-"));
    try {
      // Inherit PAX8_ALLOW_NON_HOME_CONFIG=1 from the vitest env. The
      // command should succeed exactly as in the existing idempotency tests.
      const result = await runCliExpectSuccess(
        [
          "orders", "create",
          "--company", COMPANY_ID,
          "--product", PRODUCT_ID,
          "--quantity", "5",
          "--yes", "--json",
          "--idempotency-key", KEY,
        ],
        { PAX8_IDEMPOTENCY_DIR: tmpDir },
      );
      const json = JSON.parse(result.stdout);
      expect(json).toHaveProperty("id");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("PAX8_DISPUTES_DIR home-dir guard (#M-5)", () => {
  const NON_HOME_PATH = "/tmp/pax8-m5-disputes-test";
  let inHomeConfigDir: string;
  beforeEach(async () => {
    inHomeConfigDir = await fs.mkdtemp(path.join(os.homedir(), ".pax8-m5-disp-cfg-"));
  });
  afterEach(async () => {
    await fs.rm(inHomeConfigDir, { recursive: true, force: true });
  });

  it("rejects non-home PAX8_DISPUTES_DIR without PAX8_ALLOW_NON_HOME_CONFIG", async () => {
    // Same setup as the idempotency-dir test above: pin PAX8_CONFIG_DIR
    // inside $HOME so the outer guard passes, then assert that
    // PAX8_DISPUTES_DIR (pointing outside $HOME) trips the same guard.
    const result = await runCliExpectFailure(
      [
        "invoices", "dispute",
        "--company", "Summit Healthcare",
        "--product", "Microsoft 365",
        "--yes",
        "--json",
      ],
      {
        PAX8_CONFIG_DIR: inHomeConfigDir,
        PAX8_DISPUTES_DIR: NON_HOME_PATH,
        PAX8_ALLOW_NON_HOME_CONFIG: "",
      },
    );
    expect(result.stderr).toMatch(/Refusing to use config directory outside of \$HOME/i);
    const envelope = JSON.parse(extractJsonEnvelope(result.stderr));
    expect(envelope.code).toBe("ERROR_INVALID_INPUT");
  });
});

/**
 * Pull the JSON error envelope out of stderr. Demo mode prints a banner and
 * spinner-fail glyph before the envelope when `--json` is set, so we can't
 * `JSON.parse(stderr)` directly.
 */
function extractJsonEnvelope(stderr: string): string {
  const start = stderr.indexOf("{");
  if (start < 0) throw new Error("no JSON envelope in stderr: " + stderr);
  return stderr.slice(start);
}
