// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { stripDangerousControls } from "./output.js";

/**
 * API-supplied display values (product names, company names, invoice notes)
 * flow through the table and CSV renderers verbatim. A wire-side attacker —
 * or a compromised upstream tenant directory entry — that controls one of
 * these fields could stuff in terminal control sequences and rewrite the
 * partner's terminal window title, scroll back to overwrite a confirmation
 * prompt, or inject CSI/OSC payloads that downstream tools might interpret
 * as commands.
 *
 * The contract: `stripDangerousControls` is idempotent on already-clean
 * strings, removes C0 controls (except tab/newline/CR which are part of
 * normal text), and removes CSI / OSC / lone-ESC sequences. The previous
 * `stripAnsi` helper handled only color-code SGR sequences and ran for
 * width-math only — those rules left the rendered cell value untouched.
 */
describe("stripDangerousControls", () => {
  it("leaves a plain string unchanged", () => {
    expect(stripDangerousControls("Acme Corp")).toBe("Acme Corp");
  });

  it("preserves tab, newline, and carriage return — they're normal text", () => {
    expect(stripDangerousControls("col1\tcol2\nrow2")).toBe("col1\tcol2\nrow2");
    expect(stripDangerousControls("dos\r\nline")).toBe("dos\r\nline");
  });

  it("strips OSC set-window-title sequence", () => {
    const attack = "Acme\x1b]0;owned\x07 Corp";
    expect(stripDangerousControls(attack)).toBe("Acme Corp");
  });

  it("strips CSI cursor / clear sequences", () => {
    const attack = "before\x1b[2J\x1b[H after";
    expect(stripDangerousControls(attack)).toBe("before after");
  });

  it("strips SGR color codes (subset of CSI)", () => {
    expect(stripDangerousControls("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("strips bare C0 control bytes", () => {
    expect(stripDangerousControls("A\x00B\x07C\x7fD")).toBe("ABCD");
  });

  it("strips a lone ESC at end-of-string", () => {
    expect(stripDangerousControls("trailing\x1b")).toBe("trailing");
  });

  it("strips OSC terminated by ESC-backslash (ST) too", () => {
    const attack = "x\x1b]0;t\x1b\\y";
    expect(stripDangerousControls(attack)).toBe("xy");
  });

  it("is idempotent", () => {
    const once = stripDangerousControls("Acme\x1b]0;t\x07 Corp\x1b[31m");
    const twice = stripDangerousControls(once);
    expect(twice).toBe(once);
  });
});
