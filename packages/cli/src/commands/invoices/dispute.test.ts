// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runCli, runCliExpectSuccess, runCliExpectFailure } from "../../__tests__/test-utils.js";

describe("invoices dispute (closed-loop counterpart to audit)", () => {
  let disputesDir: string;
  let idemDir: string;

  beforeEach(async () => {
    disputesDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-dispute-"));
    idemDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-dispute-idem-"));
  });

  afterEach(async () => {
    await fs.rm(disputesDir, { recursive: true, force: true });
    await fs.rm(idemDir, { recursive: true, force: true });
  });

  it("happy path: files a dispute draft from a discrepancy ID in demo mode", async () => {
    // First run audit to grab a real discrepancy ID
    const auditResult = await runCliExpectSuccess(["invoices", "audit", "--json"]);
    const report = JSON.parse(auditResult.stdout);
    expect(report.discrepancies.length).toBeGreaterThan(0);
    const discId = report.discrepancies[0].discrepancyId;
    expect(discId).toMatch(/^disc-[a-f0-9]{12}$/);

    // Audit's nextActions should now point at the dispute command
    expect(report.nextActions[0].command).toContain("invoices dispute --discrepancy");

    // File the dispute
    const result = await runCliExpectSuccess(
      ["invoices", "dispute", "--discrepancy", discId, "--yes", "--json"],
      { PAX8_DISPUTES_DIR: disputesDir },
    );
    const draft = JSON.parse(result.stdout);
    expect(draft.id).toMatch(/^disp-/);
    expect(draft.status).toBe("draft");
    expect(draft.discrepancyId).toBe(discId);
    expect(draft.portalTemplate).toContain("Billing discrepancy");
    expect(draft.portalTemplate).toContain("Pax8 billing team");
    expect(draft.filePath).toContain(disputesDir);

    // Draft persisted to disk
    const files = await fs.readdir(disputesDir);
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  it("--yes skips the confirmation prompt", async () => {
    // Without -y the command would block on stdin in non-TTY tests, hanging the
    // process. The fact that --yes makes this finish proves the prompt is
    // skipped (the test runner's 15s timeout would catch a regression).
    const auditResult = await runCliExpectSuccess(["invoices", "audit", "--json"]);
    const report = JSON.parse(auditResult.stdout);
    const discId = report.discrepancies[0].discrepancyId;

    const result = await runCliExpectSuccess(
      ["invoices", "dispute", "--discrepancy", discId, "--yes", "--json"],
      { PAX8_DISPUTES_DIR: disputesDir },
    );
    expect(result.stderr).not.toContain("File this dispute draft?");
    const draft = JSON.parse(result.stdout);
    expect(draft.status).toBe("draft");
  });

  it("--idempotency-key replays a prior dispute byte-for-byte", async () => {
    const auditResult = await runCliExpectSuccess(["invoices", "audit", "--json"]);
    const report = JSON.parse(auditResult.stdout);
    const discId = report.discrepancies[0].discrepancyId;

    const key = "dispute-idem-1234-4abc-8def-0123456789ab";

    const first = await runCliExpectSuccess(
      [
        "invoices", "dispute",
        "--discrepancy", discId,
        "--yes", "--json",
        "--idempotency-key", key,
      ],
      { PAX8_DISPUTES_DIR: disputesDir, PAX8_IDEMPOTENCY_DIR: idemDir },
    );
    expect(first.stderr).not.toContain("idempotent replay");

    const second = await runCliExpectSuccess(
      [
        "invoices", "dispute",
        "--discrepancy", discId,
        "--yes", "--json",
        "--idempotency-key", key,
      ],
      { PAX8_DISPUTES_DIR: disputesDir, PAX8_IDEMPOTENCY_DIR: idemDir },
    );
    expect(second.stderr).toContain("idempotent replay");
    expect(second.stdout).toBe(first.stdout);

    // Replay must NOT create a second file on disk.
    const files = await fs.readdir(disputesDir);
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  it("rejects when no discrepancy or company is provided", async () => {
    const result = await runCliExpectFailure(
      ["invoices", "dispute", "--yes", "--json"],
      { PAX8_DISPUTES_DIR: disputesDir },
    );
    expect(result.stderr).toMatch(/--discrepancy|--company/);
  });

  it("rejects an unknown discrepancy ID", async () => {
    const result = await runCli(
      [
        "invoices", "dispute",
        "--discrepancy", "disc-deadbeef0000",
        "--yes", "--json",
      ],
      { PAX8_DISPUTES_DIR: disputesDir },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/No discrepancy matches/);
  });

  it("--help mentions --idempotency-key (write command)", async () => {
    const result = await runCliExpectSuccess(["invoices", "dispute", "--help"]);
    expect(result.stdout).toContain("--idempotency-key");
    expect(result.stdout).toContain("24h TTL");
  });

  it("audit --json surfaces the dispute command in nextActions", async () => {
    const result = await runCliExpectSuccess(["invoices", "audit", "--json"]);
    const report = JSON.parse(result.stdout);
    expect(report.nextActions).toBeDefined();
    for (const action of report.nextActions) {
      expect(action.command).toMatch(/^pax8 invoices dispute --discrepancy disc-[a-f0-9]{12}/);
    }
  });
});
