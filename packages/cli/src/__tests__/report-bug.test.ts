// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { runCliExpectFailure, runCliExpectSuccess } from "./test-utils.js";

// Each test gets a unique config-dir so they can run in any order and pollute
// nothing on the host machine. We rely on the `PAX8_CONFIG_DIR` seam from
// #128, which `getConfigDir()` honors.
async function makeTmpConfigDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "pax8-report-bug-"));
}

const SAMPLE_ENVELOPE = {
  code: "ERROR_AUTH_EXPIRED",
  message: "Authentication failed for client_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  causes: [
    "Token expired",
    "Cached at /Users/jdulberger/.pax8/cache/auth-token.json",
  ],
  recoverySteps: ["Run pax8 auth login to re-authenticate."],
  docsUrl: "https://docs.pax8.com/auth",
  command: "companies list",
  flags: ["--json"],
  cli_version: "0.1.0",
  node_version: "v22.5.1",
  os: "darwin",
  timestamp: "2026-05-05T12:00:00.000Z",
};

describe("pax8 report-bug", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpConfigDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("no last-error context exits 0 with manual-file-a-bug instructions (#209)", async () => {
    // Bare `report-bug` with no captured error must be helpful, not a hard
    // exit. README lists it as a quick-start example so first-run users
    // hit this branch; #209 changed it from exit-1-on-stderr to exit-0
    // with a short pointer to the issue tracker.
    const result = await runCliExpectSuccess(["report-bug"], {
      PAX8_CONFIG_DIR: tmpDir,
    });
    expect(result.stdout).toContain("No recent error in this session.");
    expect(result.stdout).toContain(
      "https://github.com/pax8labs/pax8-cli/issues/new"
    );
    expect(result.stdout).toContain("pax8 report-bug --help");
    // Instructions go to stdout (not stderr) because this is a successful,
    // informational response — not an error. (Demo-mode banner on stderr
    // is fine; what matters is no "No recent error found" error line.)
    expect(result.stderr).not.toContain("No recent error");
  });

  it("no last-error context with --print also exits 0 with instructions", async () => {
    const result = await runCliExpectSuccess(["report-bug", "--print"], {
      PAX8_CONFIG_DIR: tmpDir,
    });
    expect(result.stdout).toContain("No recent error in this session.");
  });

  it("no last-error context with --json emits a no-context envelope", async () => {
    const result = await runCliExpectSuccess(["report-bug", "--json"], {
      PAX8_CONFIG_DIR: tmpDir,
    });
    const parsed = JSON.parse(result.stdout) as {
      status?: string;
      issueUrl?: string;
    };
    expect(parsed.status).toBe("no-context");
    expect(parsed.issueUrl).toBe(
      "https://github.com/pax8labs/pax8-cli/issues/new"
    );
  });

  it("--print outputs a redacted Markdown body and does not submit", async () => {
    await fs.writeFile(
      path.join(tmpDir, "last-error.json"),
      JSON.stringify(SAMPLE_ENVELOPE)
    );
    const result = await runCliExpectSuccess(["report-bug", "--print"], {
      PAX8_CONFIG_DIR: tmpDir,
    });
    // PII is gone…
    expect(result.stdout).not.toContain("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(result.stdout).not.toContain("jdulberger");
    // …but the markers prove the redactor ran.
    expect(result.stdout).toContain("<REDACTED:UUID>");
    expect(result.stdout).toContain("<REDACTED:PATH>");
    // The body has the expected sections.
    expect(result.stdout).toContain("[ERROR_AUTH_EXPIRED]");
    expect(result.stdout).toContain("**Error code:**");
    expect(result.stdout).toContain("### Message");
    expect(result.stdout).toContain("Sanitized by `pax8 report-bug`");
    // No submission attempted (we never reach the gh fork without -y).
    expect(result.stdout).not.toContain("https://github.com/pax8labs");
  });

  it("--json outputs the redacted envelope as JSON", async () => {
    await fs.writeFile(
      path.join(tmpDir, "last-error.json"),
      JSON.stringify(SAMPLE_ENVELOPE)
    );
    const result = await runCliExpectSuccess(["report-bug", "--json"], {
      PAX8_CONFIG_DIR: tmpDir,
    });
    const parsed = JSON.parse(result.stdout);
    expect(parsed.code).toBe("ERROR_AUTH_EXPIRED");
    expect(parsed.message).toContain("<REDACTED:UUID>");
    // Pre-redaction PII must not survive.
    const all = JSON.stringify(parsed);
    expect(all).not.toContain("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(all).not.toContain("jdulberger");
  });

  it("the [y/N] prompt is bypassed under PAX8_YES=1 with --print so no submission attempt is made", async () => {
    // We can't actually exercise the submission path in CI (would call `gh`
    // or open a browser). What we can verify is that --print short-circuits
    // before any prompt, and that PAX8_YES=1 plumbing is wired.
    await fs.writeFile(
      path.join(tmpDir, "last-error.json"),
      JSON.stringify(SAMPLE_ENVELOPE)
    );
    const result = await runCliExpectSuccess(["report-bug", "--print"], {
      PAX8_CONFIG_DIR: tmpDir,
      PAX8_YES: "1",
    });
    expect(result.stdout).toContain("[ERROR_AUTH_EXPIRED]");
  });

  it("treats malformed last-error.json as no-context (graceful fallback)", async () => {
    // Same path as "no last-error context": readEnvelope() returns null on
    // parse failure, so the user gets the same helpful instructions rather
    // than a stack trace or error exit.
    await fs.writeFile(path.join(tmpDir, "last-error.json"), "not json");
    const result = await runCliExpectSuccess(["report-bug", "--print"], {
      PAX8_CONFIG_DIR: tmpDir,
    });
    expect(result.stdout).toContain("No recent error in this session.");
  });

  it("shows help text", async () => {
    const result = await runCliExpectSuccess(["report-bug", "--help"]);
    expect(result.stdout).toContain("File a sanitized GitHub issue");
    expect(result.stdout).toContain("--print");
    expect(result.stdout).toContain("--yes");
    expect(result.stdout).toContain("--json");
  });
});

describe("handleCommandError last-error.json side effect", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpConfigDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a structured envelope on a CliError and is mode 0600", async () => {
    // Force a CliError by asking for a company that doesn't exist in demo data.
    const result = await runCliExpectFailure(
      ["companies", "show", "definitely-does-not-exist", "--json"],
      { PAX8_CONFIG_DIR: tmpDir }
    );
    expect(result.exitCode).toBe(1);

    const envPath = path.join(tmpDir, "last-error.json");
    const stat = await fs.stat(envPath);
    // Mode check (skip on Windows where chmod is a no-op).
    if (process.platform !== "win32") {
      // Lower 9 bits represent rwxrwxrwx; we want owner-only rw (0o600).
      const perms = stat.mode & 0o777;
      expect(perms).toBe(0o600);
    }
    const raw = await fs.readFile(envPath, "utf-8");
    const env = JSON.parse(raw);
    expect(typeof env.message).toBe("string");
    expect(env.code).toBe("ERROR_COMPANY_NOT_FOUND");
    expect(typeof env.cli_version).toBe("string");
    expect(typeof env.node_version).toBe("string");
    expect(typeof env.os).toBe("string");
    expect(typeof env.timestamp).toBe("string");
    expect(env.command).toContain("companies");
    expect(Array.isArray(env.flags)).toBe(true);
    expect(env.flags).toContain("--json");
  });

  it("end-to-end: failed command → report-bug --print produces a redacted body", async () => {
    // Cause a failure that populates last-error.json.
    await runCliExpectFailure(
      ["companies", "show", "definitely-does-not-exist", "--json"],
      { PAX8_CONFIG_DIR: tmpDir }
    );

    // Now report-bug should pick it up.
    const result = await runCliExpectSuccess(["report-bug", "--print"], {
      PAX8_CONFIG_DIR: tmpDir,
    });
    expect(result.stdout).toContain("[ERROR_COMPANY_NOT_FOUND]");
    expect(result.stdout).toContain("Sanitized by `pax8 report-bug`");
  });

  // #170: regression test — a company name typed at the CLI must not appear
  // anywhere in the persisted envelope. The `command` field renders
  // `<REDACTED:ARG>` placeholders; the `message` / `causes` / etc. get the
  // same value scrubbed via the redactor's argTokens post-pass.
  it("does not leak a positional company-name argument into last-error.json (#170)", async () => {
    const sensitiveName = "ZZZSensitiveCustomerInc";
    await runCliExpectFailure(
      ["companies", "show", sensitiveName, "--json"],
      { PAX8_CONFIG_DIR: tmpDir }
    );

    const envPath = path.join(tmpDir, "last-error.json");
    const raw = await fs.readFile(envPath, "utf-8");
    // The raw value must not appear anywhere in the file on disk.
    expect(raw).not.toContain(sensitiveName);

    const env = JSON.parse(raw);
    // Structure preserved.
    expect(env.command).toBe("companies show <REDACTED:ARG>");
    expect(env.flags).toContain("--json");
    expect(env.code).toBe("ERROR_COMPANY_NOT_FOUND");
    // Message had the value interpolated (`Company not found: "${input}"`)
    // and now shows the placeholder.
    expect(env.message).toContain("<REDACTED:ARG>");
    expect(env.message).not.toContain(sensitiveName);
  });

  it("report-bug --print does not leak the positional value in its body (#170)", async () => {
    const sensitiveName = "ZZZSensitiveCustomerInc";
    await runCliExpectFailure(
      ["companies", "show", sensitiveName, "--json"],
      { PAX8_CONFIG_DIR: tmpDir }
    );
    const result = await runCliExpectSuccess(["report-bug", "--print"], {
      PAX8_CONFIG_DIR: tmpDir,
    });
    expect(result.stdout).not.toContain(sensitiveName);
    expect(result.stdout).toContain("<REDACTED:ARG>");
    expect(result.stdout).toContain("companies show <REDACTED:ARG>");
  });
});
