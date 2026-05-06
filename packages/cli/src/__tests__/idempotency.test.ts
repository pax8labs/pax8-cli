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
      ["companies", "list", "--idempotency-key", "abc12345-1234-4abc-8def-0123456789ab"],
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
    const result = await runCliExpectSuccess(["companies", "list", "--help"]);
    expect(result.stdout).not.toContain("--idempotency-key");
  });
});
