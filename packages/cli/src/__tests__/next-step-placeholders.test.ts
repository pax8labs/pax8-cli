// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Static-source regression guard for the number-pickable next-step pattern.
 *
 * The PR that introduced this test converted ~12 plain-text "Try next:"
 * blocks into pickable `promptNextSteps` lists. Pickable means: type a
 * number, drill in. That contract breaks the moment a `NextStep.command`
 * carries an unresolved placeholder like `<id>` or `<n>` — there's no
 * value behind the placeholder for the child process to consume.
 *
 * This test parses every source file under `packages/cli/src/commands/`
 * looking for two specific anti-patterns:
 *
 *   1. A `NextStep` `command:` array containing a token with `<...>`
 *      placeholder syntax. This is the hard rule: pickable commands must
 *      be fully resolved.
 *
 *   2. A `process.stderr.write(...)` line inside a `Try next:` block that
 *      contains `<...>` placeholder syntax inside `chalk.cyan(replCmd(...))`.
 *      Catches the legacy "copy-paste suggestion" pattern this PR removed.
 *
 * Affordance pointers (free-form prose telling the partner that a flag
 * exists, e.g. "adjust quantity — run `subscriptions update --help`") are
 * fine. They name a capability without offering a literal command, so
 * placeholder syntax in `--help` text or feature descriptions doesn't
 * trigger this guard.
 */

const COMMANDS_DIR = join(
  process.cwd().endsWith("packages/cli") ? process.cwd() : join(process.cwd(), "packages/cli"),
  "src/commands",
);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (s.isFile() && name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const PLACEHOLDER_RE = /<[A-Za-z][A-Za-z0-9_| -]*>/;

/**
 * Find every NextStep object literal's `command:` array and return any
 * tokens that contain placeholder syntax. We scan line-by-line: a line
 * matching `command: [` starts an array we then walk until the matching
 * `]`. Tokens are extracted from string literals — both `"..."` and
 * template literals like `\`pax8 ... ${id}\``.
 */
function findPlaceholderCommandTokens(source: string): string[] {
  const hits: string[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/command:\s*\[/.test(lines[i])) continue;
    // Accumulate the array body across lines until depth returns to 0.
    let depth = 0;
    let buf = "";
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "[") depth++;
        else if (ch === "]") depth--;
        buf += ch;
        if (depth === 0 && buf.includes("[")) break;
      }
      if (depth === 0 && buf.includes("[")) break;
      buf += "\n";
    }
    // Pull out string literals from the array body. Look at quoted segments;
    // template literals can also carry `${var}` which we treat as resolved.
    const literalMatches = buf.match(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g) ?? [];
    for (const lit of literalMatches) {
      const inner = lit.slice(1, -1);
      // Skip template-literal `${...}` interpolations — these ARE resolved
      // at runtime, so an embedded `<foo>` inside `${someVar ?? "<…>"}` is
      // an unusual edge case we accept.
      if (PLACEHOLDER_RE.test(inner)) {
        hits.push(inner);
      }
    }
  }
  return hits;
}

/**
 * Find every `process.stderr.write(...)` call that follows a `Try next:`
 * header in the same scope and contains `chalk.cyan(replCmd(...))` with a
 * placeholder inside. This catches the legacy plain-text pattern this PR
 * removed; future drift back to that pattern is what we want to prevent.
 */
function findPlaceholderTryNextSuggestions(source: string): string[] {
  const hits: string[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/Try next:/.test(lines[i])) continue;
    // Walk forward up to 30 lines, stopping when we hit a closing brace
    // at an outer indent or a blank-only stderr.write.
    for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
      const line = lines[j];
      if (/^\s*}\s*$/.test(line)) break;
      // Look for a stderr.write that emits a suggestion line with cyan(replCmd(...))
      if (/process\.stderr\.write\s*\([^)]*chalk\.cyan\s*\(\s*replCmd\s*\(/.test(line)) {
        // Extract the replCmd argument string literal
        const m = line.match(/replCmd\s*\(\s*(`[^`]*`|"[^"]*"|'[^']*')/);
        if (m) {
          const inner = m[1].slice(1, -1);
          if (PLACEHOLDER_RE.test(inner)) {
            hits.push(inner);
          }
        }
      }
    }
  }
  return hits;
}

describe("next-step placeholder regression guard", () => {
  it("NextStep `command:` arrays never carry `<placeholder>` tokens", () => {
    const offenders: { file: string; tokens: string[] }[] = [];
    for (const file of walk(COMMANDS_DIR)) {
      const src = readFileSync(file, "utf8");
      const tokens = findPlaceholderCommandTokens(src);
      if (tokens.length > 0) {
        offenders.push({ file: file.replace(process.cwd() + "/", ""), tokens });
      }
    }
    expect(offenders, formatOffenders(offenders)).toEqual([]);
  });

  it("`Try next:` blocks never emit plain-text suggestions with `<placeholder>` syntax", () => {
    const offenders: { file: string; tokens: string[] }[] = [];
    for (const file of walk(COMMANDS_DIR)) {
      const src = readFileSync(file, "utf8");
      const tokens = findPlaceholderTryNextSuggestions(src);
      if (tokens.length > 0) {
        offenders.push({ file: file.replace(process.cwd() + "/", ""), tokens });
      }
    }
    expect(offenders, formatOffenders(offenders)).toEqual([]);
  });
});

function formatOffenders(
  offenders: { file: string; tokens: string[] }[],
): string {
  if (offenders.length === 0) return "ok";
  return (
    "Found placeholder syntax in pickable next-step entries — these should " +
    "either resolve the placeholder at runtime (pickable) or move out of the " +
    '"Try next:" block into an affordance pointer ("run X --help for syntax"):\n' +
    offenders
      .map(
        (o) => `  ${o.file}\n    ${o.tokens.map((t) => `→ ${t}`).join("\n    ")}`,
      )
      .join("\n")
  );
}
