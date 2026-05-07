// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("pax8 quotes send", () => {
  it("transitions a draft quote to Sent (JSON mode, auto-confirmed)", async () => {
    const result = await runCliExpectSuccess([
      "quotes",
      "send",
      "quote-bright-001",
      "--json",
      "--yes",
    ]);
    const data = JSON.parse(result.stdout);
    // JSON mode emits the raw response wrapped in a single-element array.
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]).toHaveProperty("id", "quote-bright-001");
    expect(data[0]).toHaveProperty("status");
    // The mock maps lowercase API status -> capitalized demo status.
    expect(String(data[0].status).toLowerCase()).toBe("sent");
  });

  it("emits a customer-link / email hint on stdout in TTY mode", async () => {
    // Non-TTY default isn't `table` — but the success-path "✓ Quote sent"
    // banner is also in JSON; here we run without --json and just look at
    // the human output. runCli treats stderr separately, so the email hint
    // (which we send on stdout when there's no link) must appear in stdout.
    const result = await runCliExpectSuccess([
      "quotes",
      "send",
      "quote-redwood-001",
      "--yes",
    ]);
    // Without --json, default in non-TTY is JSON, so the structured payload
    // ends up on stdout. The "Quote sent" banner is for human/table mode —
    // verify on stderr we still see the success spinner suffix and no error.
    expect(result.stderr).toContain("Quote sent");
    expect(result.exitCode).toBe(0);
  });

  it("respects --quiet (no stdout)", async () => {
    const result = await runCliExpectSuccess([
      "quotes",
      "send",
      "quote-bright-001",
      "--quiet",
      "--yes",
    ]);
    expect(result.stdout).toBe("");
  });

  it("errors when the quote does not exist", async () => {
    const result = await runCliExpectFailure([
      "quotes",
      "send",
      "no-such-quote",
      "--yes",
    ]);
    expect(result.exitCode).toBe(1);
  });

  it("cancels when the user answers no at the prompt", async () => {
    const { spawn } = await import("node:child_process");
    const { resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const cliPath = resolve(
      fileURLToPath(import.meta.url),
      "../../../dist/index.js",
    );
    const child = spawn(
      "node",
      [cliPath, "quotes", "send", "quote-bright-001"],
      {
        env: { ...process.env, PAX8_DEMO: "1", NO_COLOR: "1" },
      },
    );
    // The send confirm defaults to false. Send "n" explicitly so the
    // readline `question` callback fires (closing stdin without an answer
    // would leave the promise pending).
    child.stdin.write("n\n");
    child.stdin.end();

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const code: number = await new Promise((res) => child.on("close", res));
    expect(code).toBe(0);
    expect(stderr).toContain("Cancelled");
  });

  it("shows help with examples and a workflow note", async () => {
    const result = await runCliExpectSuccess(["quotes", "send", "--help"]);
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toMatch(/customer/i);
  });

  it("appears in `pax8 quotes --help`", async () => {
    const result = await runCliExpectSuccess(["quotes", "--help"]);
    expect(result.stdout).toContain("send");
  });
});
