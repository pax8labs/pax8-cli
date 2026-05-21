// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli } from "./test-utils.js";

/**
 * The on-disk last-error.json envelope has been redacted since #170, but the
 * parallel user-facing paths (`--json` stderr envelope and the human-readable
 * stderr branches) were emitting raw UUIDs, emails, and home paths verbatim —
 * including any upstream API echo of a user-supplied input. That gap closes
 * here.
 *
 * These tests exercise the actual stderr the CLI emits (subprocess-based)
 * rather than reaching into `handleCommandError`, so a future refactor that
 * changes the internal call shape can't silently un-redact the surface.
 */
describe("error stderr is redacted", () => {
  // Use a name-shaped arg that the demo client's name lookup cannot resolve;
  // UUID-shaped args take the get-by-id path which the demo always satisfies.
  const PII_NAME = "rachel.thornton-not-a-real-company@leak.example";

  it("--json: a PII-shaped positional arg does not survive into stderr verbatim", async () => {
    const result = await runCli(["clients", "show", PII_NAME, "--json"]);
    expect(result.exitCode).not.toBe(0);
    // The raw value must not appear in either the message or the causes
    // (extractErrorDetail-derived) field of the envelope. The redactor will
    // replace it with <REDACTED:ARG> (full-match positional arg rule), and
    // the embedded email-shaped substring with <REDACTED:EMAIL>.
    expect(result.stderr).not.toContain(PII_NAME);
    expect(result.stderr).toContain("<REDACTED:");
  });

  it("human mode: a PII-shaped positional arg does not survive into stderr verbatim", async () => {
    const result = await runCli(["clients", "show", PII_NAME]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain(PII_NAME);
    expect(result.stderr).toContain("<REDACTED:");
  });
});
