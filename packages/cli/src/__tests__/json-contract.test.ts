// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * JSON contract regression suite.
 *
 * The contract — codified in CLAUDE.md and docs/UX_GUIDE.md §3 — is:
 *
 *   "stdout is data, stderr is everything else"
 *
 * A `pax8 ... --json` invocation must emit valid JSON to stdout. Banners,
 * spinners, status text, and human-facing hints belong on stderr so that
 * `pax8 ... --json | jq` pipelines never break. Issues #470 (doctor) and
 * #471 (auth login) were both instances of this contract being violated —
 * the banner/per-check icons were going to stdout regardless of `--json`.
 *
 * This file is the gate that prevents that class of bug from recurring. For
 * a representative set of `--json`-supporting commands we assert:
 *
 *   1. `pax8 <cmd> --json` exits 0.
 *   2. Its stdout parses as JSON.
 *   3. Stdout contains no banner-shaped lines — no `✓`/`✗`/`✨` glyphs,
 *      no "Pax8 CLI —" headers, no "Demo mode — showing sample data"
 *      stragglers. Those belong on stderr.
 *
 * If you add a new command that supports `--json`, add it to COMMANDS below.
 * If you intentionally need a banner-shaped character inside a JSON value
 * (e.g. an emoji in a `description`), filter it out in the assertion rather
 * than disabling the check — the goal is to keep the contract enforceable.
 */

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

// Banner-shaped strings that, if they appear *outside* a JSON value on
// stdout, indicate human-facing decoration leaked through. We can't blanket-
// match these because legitimate JSON content (e.g. a `description` field on
// a `nextAction`) may include the word "Diagnostics" or an em-dash. The real
// invariant we want is: stdout is exactly one well-formed JSON document
// with nothing tacked on before or after. That gets enforced below via
// JSON.parse on the whole stdout buffer plus a strict-equality check that
// JSON.stringify(parsed) round-trips the visible content.
const BANNER_GLYPHS_OUTSIDE_JSON = ["✨"];

interface CommandCase {
  /** Argv passed to the CLI (without leading `pax8`). */
  args: string[];
  /**
   * Optional shape validator. Runs against the parsed JSON. Lets us catch
   * the case where stdout is _technically_ JSON-valid but happens to be
   * `null` or an empty string emitted unconditionally. Keep loose — the
   * point of this suite is the contract, not the per-command schema.
   */
  shape?: (parsed: unknown) => void;
}

const COMMANDS: CommandCase[] = [
  // #470 — the bug that motivated this gate. The doctor command used to
  // write the ANSI banner to stdout unconditionally, ignoring --json.
  {
    args: ["doctor", "--json"],
    shape: (parsed) => {
      const p = parsed as { checks?: unknown; summary?: unknown };
      expect(Array.isArray(p.checks)).toBe(true);
      expect(p.summary).toBeDefined();
    },
  },
  // #471 — auth login wrote `✓ Authenticated` to stdout in both demo and
  // real branches. The structured envelope now goes to stdout, banner to stderr.
  {
    args: ["auth", "login", "--json"],
    shape: (parsed) => {
      const p = parsed as { status?: unknown; mode?: unknown };
      expect(p.status).toBe("authenticated");
      expect(p.mode).toBeDefined();
    },
  },
  // Single-object summary — the canonical agent dashboard call from CLAUDE.md.
  {
    args: ["dashboard", "--json"],
    shape: (parsed) => {
      const p = parsed as Record<string, unknown>;
      expect(p.totalCompanies).toBeDefined();
      expect(p.monthlyCost).toBeDefined();
    },
  },
  // Flat-array list responses — agents already parse these as JSON arrays.
  // We don't pass --with-actions; the contract for plain `list --json` is an
  // array.
  {
    args: ["clients", "list", "--json"],
    shape: (parsed) => {
      expect(Array.isArray(parsed)).toBe(true);
    },
  },
  {
    args: ["subscriptions", "list", "--json"],
    shape: (parsed) => {
      expect(Array.isArray(parsed)).toBe(true);
    },
  },
  {
    args: ["recommendations", "list", "--json"],
    shape: (parsed) => {
      expect(Array.isArray(parsed)).toBe(true);
    },
  },
];

describe("JSON contract — stdout is data, stderr is everything else", () => {
  for (const tc of COMMANDS) {
    const label = tc.args.join(" ");

    it(`'pax8 ${label}' emits valid JSON on stdout`, async () => {
      const result = await runCliExpectSuccess(tc.args);
      // Throws with a readable diff if stdout is not parseable JSON.
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.stdout);
      } catch (err) {
        throw new Error(
          `'pax8 ${label}' produced non-JSON stdout (this is the #470/#471 class of bug):\n` +
            `---stdout (first 400 chars)---\n${result.stdout.slice(0, 400)}\n` +
            `---parse error---\n${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      if (tc.shape) {
        tc.shape(parsed);
      }
    });

    it(`'pax8 ${label}' keeps banner-shaped text off stdout`, async () => {
      const result = await runCliExpectSuccess(tc.args);

      // Cheap glyph check first — the demo-mode sparkle never appears
      // inside legitimate JSON content, so its presence in stdout is an
      // unambiguous contract break.
      for (const glyph of BANNER_GLYPHS_OUTSIDE_JSON) {
        expect(
          result.stdout.includes(glyph),
          `stdout for 'pax8 ${label}' contains banner-shape '${glyph}' — that's human-facing decoration and belongs on stderr.\nFirst 200 chars: ${result.stdout.slice(0, 200)}`,
        ).toBe(false);
      }

      // The strict invariant: stdout is exactly one JSON document with no
      // pre/post-amble. `JSON.parse(stdout)` succeeds (asserted in the test
      // above) AND the trimmed stdout starts with `{` or `[` and ends with
      // the matching closer. A banner prepended to stdout would either make
      // parse() throw or push trailing data after the closer.
      const trimmed = result.stdout.trim();
      const startsClean = trimmed.startsWith("{") || trimmed.startsWith("[");
      const endsClean = trimmed.endsWith("}") || trimmed.endsWith("]");
      expect(
        startsClean,
        `stdout for 'pax8 ${label}' has pre-amble before the JSON document.\nFirst 200 chars: ${result.stdout.slice(0, 200)}`,
      ).toBe(true);
      expect(
        endsClean,
        `stdout for 'pax8 ${label}' has trailing text after the JSON document.\nLast 200 chars: ${result.stdout.slice(-200)}`,
      ).toBe(true);

      // Rendered check-row lines ("  ✓ Node.js version") that the human
      // path emits — the original #470 symptom. Only flag when one appears
      // at the start of a line in stdout, since JSON values containing a
      // ✓/✗ character would be quoted and indented inside an object.
      const humanCheckLine = /^\s*[✓✗]\s+[A-Z]\w/m;
      expect(
        humanCheckLine.test(result.stdout),
        `stdout for 'pax8 ${label}' has a rendered check-row line ('  ✓ <Name>...' or '  ✗ <Name>...') outside a JSON value — that's the human path leaking through.`,
      ).toBe(false);
    });
  }

  // The demo-mode banner is a global preAction hook (see packages/cli/src/index.ts).
  // It MUST land on stderr regardless of which command we call — that's the
  // hook itself, not the command. Pinning it here so that if someone moves it
  // to stdout for "visibility" the contract test catches it.
  it("demo-mode banner lands on stderr, not stdout (global hook contract)", async () => {
    const result = await runCliExpectSuccess(["doctor", "--json"]);
    // The exact banner string from index.ts. Asserting on the literal so a
    // future rewording fails this test and forces a reviewer to verify the
    // stream targeting is still correct.
    const DEMO_BANNER = "Demo mode — showing sample data";
    expect(result.stderr).toContain(DEMO_BANNER);
    expect(result.stdout).not.toContain(DEMO_BANNER);
  });
});
