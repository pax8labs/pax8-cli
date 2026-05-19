// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { recordWriteAudit } from "./write-audit.js";

describe("recordWriteAudit", () => {
  let tmpDir: string;
  const originalConfigDir = process.env.PAX8_CONFIG_DIR;
  const originalArgv = [...process.argv];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pax8-write-audit-test-"));
    process.env.PAX8_CONFIG_DIR = tmpDir;
    process.argv = ["node", "test"];
  });

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.PAX8_CONFIG_DIR;
    else process.env.PAX8_CONFIG_DIR = originalConfigDir;
    process.argv = originalArgv;
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  });

  function readLog(): unknown[] {
    const filepath = join(tmpDir, "write-audit.log");
    const raw = fs.readFileSync(filepath, "utf-8");
    return raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
  }

  it("writes a JSON-lines entry on the first call and creates the file at mode 0600", () => {
    process.argv = ["node", "test", "orders", "create"];
    recordWriteAudit({ resource: "orders", outcome: "completed", idempotencyKey: "abc-123" });

    const filepath = join(tmpDir, "write-audit.log");
    expect(fs.existsSync(filepath)).toBe(true);

    // POSIX-only assertion: Windows doesn't honor POSIX mode bits on
    // file creation — `fs.openSync(..., 0o600)` falls back to the
    // platform default. The audit log's confidentiality on Windows
    // depends on the parent directory's ACL (the `.pax8` config dir
    // inherits user-only by convention). See the Windows note in
    // write-audit.ts for the deliberate limitation.
    if (process.platform !== "win32") {
      const stat = fs.statSync(filepath);
      expect(stat.mode & 0o777).toBe(0o600);
    }

    const entries = readLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      command: "orders create",
      resource: "orders",
      outcome: "completed",
      idempotencyKey: "abc-123",
    });
    expect(entries[0]).toHaveProperty("timestamp");
    expect(/^\d{4}-\d{2}-\d{2}T/.test((entries[0] as { timestamp: string }).timestamp)).toBe(true);
  });

  it("appends subsequent entries — does not truncate", () => {
    process.argv = ["node", "test", "subscriptions", "cancel"];
    recordWriteAudit({ resource: "subscriptions", outcome: "completed" });
    recordWriteAudit({ resource: "subscriptions", outcome: "cancelled", idempotencyKey: "xyz" });
    const entries = readLog();
    expect(entries).toHaveLength(2);
    expect((entries[0] as { outcome: string }).outcome).toBe("completed");
    expect((entries[1] as { outcome: string }).outcome).toBe("cancelled");
    expect((entries[1] as { idempotencyKey?: string }).idempotencyKey).toBe("xyz");
  });

  it("omits the idempotencyKey field when not supplied", () => {
    recordWriteAudit({ resource: "orders", outcome: "completed" });
    const entry = readLog()[0] as Record<string, unknown>;
    expect(entry).not.toHaveProperty("idempotencyKey");
  });

  it("strips positional-arg values from the command field", () => {
    // A command like `pax8 companies show "Real Customer Inc"` should
    // record as `"companies show"` — never the customer name.
    process.argv = ["node", "test", "companies", "show", "Real Customer Inc"];
    recordWriteAudit({ resource: "companies", outcome: "completed" });
    const entry = readLog()[0] as { command: string };
    expect(entry.command).toBe("companies show");
    expect(entry.command).not.toContain("Real Customer Inc");
  });

  it("refuses to follow a symlink at the audit-log path (O_NOFOLLOW, POSIX-only)", () => {
    // Windows' fs.openSync silently ignores O_NOFOLLOW and resolves
    // the symlink — the protection here is genuinely POSIX-only.
    // The Windows audit log inherits ACL protection from the parent
    // .pax8 dir instead. Documented in write-audit.ts.
    if (process.platform === "win32") return;

    const filepath = join(tmpDir, "write-audit.log");
    const decoy = join(tmpDir, "decoy.txt");
    fs.writeFileSync(decoy, "untouched");
    fs.symlinkSync(decoy, filepath);

    // Should silently swallow the symlink-refusal (best-effort contract).
    recordWriteAudit({ resource: "orders", outcome: "completed" });

    // The decoy must be untouched — the audit append must NOT have
    // followed the symlink and clobbered it.
    expect(fs.readFileSync(decoy, "utf-8")).toBe("untouched");
  });

  it("swallows I/O failures — never throws", () => {
    // Point to an unwritable target directory by setting an invalid
    // config dir. The recordWriteAudit call must not throw.
    process.env.PAX8_CONFIG_DIR = "/proc/cannot-write-here-on-purpose";
    expect(() => {
      recordWriteAudit({ resource: "orders", outcome: "completed" });
    }).not.toThrow();
  });
});
