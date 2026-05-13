// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli } from "./test-utils.js";

/**
 * Regression guard for #426: `pax8 quotes create` is a shorthand that
 * orchestrates `POST /v2/quotes` + `POST /v2/quotes/{id}/line-items` in one
 * call. The shorthand must accept every line-item flag that
 * `pax8 quotes line-items add` accepts — otherwise partners using the
 * shorthand can silently produce line items missing `--billing-term`,
 * `--price`, `--effective-date`, etc. (the kind of subtle wrongness Fred
 * Lintz flagged on the domain review).
 *
 * "Parity" here means: every long flag declared on `quotes line-items add`
 * also appears on `quotes create`. `create` is allowed to declare *extra*
 * flags (notably `--company`, which `add` doesn't need because it takes
 * the quote-id as a positional arg), but it must not be missing any.
 *
 * If you add a new line-item flag to `quotes line-items add`, you must
 * also add it to `quotes create` (or this test fails). If you intentionally
 * want a flag to live only on `add`, update the EXCLUDED_FROM_PARITY set
 * below and explain why in a code comment.
 */
describe("pax8 quotes create / quotes line-items add flag parity (#426)", () => {
  /**
   * Flags declared on `line-items add` that intentionally don't appear on
   * `quotes create`. Empty today — every line-item flag is mirrored. If
   * you add an entry here, add a comment explaining why the asymmetry is
   * justified (e.g. a flag that only makes sense post-creation).
   */
  const EXCLUDED_FROM_PARITY = new Set<string>([]);

  /**
   * Parse the `--help` output of a Commander command and return the set of
   * long flags it declares (e.g. `--billing-term`, `--price`). We look only
   * at the "Options:" section so help-footer mentions of other commands
   * don't pollute the set.
   */
  function extractLongFlags(help: string): Set<string> {
    // Commander prints options after a literal "Options:" header and ends
    // the block on the next blank line + non-indented section (e.g. our
    // help-text footer or "Examples:"). Find the Options: block and parse
    // long flags from it.
    const optionsIdx = help.indexOf("Options:");
    if (optionsIdx < 0) {
      throw new Error("Help output is missing an 'Options:' section");
    }
    const afterOptions = help.slice(optionsIdx + "Options:".length);
    // The Options block ends at the next double-newline that isn't followed
    // by an indented continuation line. The simplest heuristic: stop at the
    // first line that starts a new top-level section (no leading whitespace
    // and ends with `:` like `Examples:` or `Body shape (...)`).
    const lines = afterOptions.split("\n");
    const collected: string[] = [];
    for (const line of lines) {
      if (/^[A-Z][^\n]*:\s*$/.test(line) || /^[A-Z][^\n]+:\s/.test(line)) {
        // New top-level section header (e.g. "Examples:", "Setting an
        // expiration date:") — stop. Indented continuation lines inside
        // the Options block always start with whitespace, so this only
        // fires on real section breaks.
        if (collected.length > 0) break;
      }
      collected.push(line);
    }
    const block = collected.join("\n");
    const flags = new Set<string>();
    // Match `--flag-name` at any position; restrict to the kebab-case form
    // Commander emits. Skip `--help` since it's auto-added by Commander.
    const re = /--([a-z][a-z0-9-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      const flag = `--${m[1]}`;
      if (flag === "--help") continue;
      flags.add(flag);
    }
    return flags;
  }

  it("`quotes create` accepts every line-item flag declared on `quotes line-items add`", async () => {
    const [createHelp, addHelp] = await Promise.all([
      runCli(["quotes", "create", "--help"]),
      runCli(["quotes", "line-items", "add", "--help"]),
    ]);

    expect(createHelp.exitCode).toBe(0);
    expect(addHelp.exitCode).toBe(0);

    const createFlags = extractLongFlags(createHelp.stdout);
    const addFlags = extractLongFlags(addHelp.stdout);

    // Sanity: we should have parsed a non-trivial flag set out of `add`.
    // If this assertion fails the extractor is broken and the parity check
    // below would silently pass.
    expect(addFlags.size).toBeGreaterThanOrEqual(4);
    expect(addFlags.has("--product")).toBe(true);
    expect(addFlags.has("--quantity")).toBe(true);
    expect(addFlags.has("--billing-term")).toBe(true);

    const missing = [...addFlags].filter(
      (flag) => !EXCLUDED_FROM_PARITY.has(flag) && !createFlags.has(flag),
    );

    expect(
      missing,
      `quotes create is missing flags that quotes line-items add declares: ${missing.join(", ")}.\n`
        + `Mirror these onto quotes create (see #426), or add to EXCLUDED_FROM_PARITY with a code comment.`,
    ).toEqual([]);
  });

  it("`quotes create` and `quotes line-items add` agree on the well-known line-item flags", async () => {
    // Belt-and-braces assertion: pin the concrete flag names so future
    // refactors don't accidentally remove one. This is the contract Fred
    // Lintz's domain-review comment called out.
    const createHelp = await runCli(["quotes", "create", "--help"]);
    expect(createHelp.exitCode).toBe(0);
    const createFlags = extractLongFlags(createHelp.stdout);
    for (const flag of [
      "--product",
      "--quantity",
      "--billing-term",
      "--price",
      "--effective-date",
    ]) {
      expect(createFlags.has(flag), `quotes create is missing ${flag}`).toBe(true);
    }
  });
});
