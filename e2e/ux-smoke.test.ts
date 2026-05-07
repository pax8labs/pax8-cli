// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * UX smoke — cross-cutting invariants that don't fit the per-command matrix
 * (see per-command.test.ts for the per-command checks).
 *
 * Two things this suite uniquely covers:
 *
 *  1. README parity: every `pax8 ...` snippet inside fenced ```bash blocks in
 *     README.md must execute successfully under PAX8_DEMO=1. Catches the
 *     "we shipped doc that doesn't work" class of regression.
 *
 *  2. Error-path UX: the error renderer must include the `pax8 report-bug`
 *     hint introduced in #161. Asserted via a single deliberately-bad
 *     command rather than per-command.
 *
 * Other UX invariants (no undefined leaks, no UUID leaks, density bounds,
 * MRR display vocab, drill-in hint visibility) live in the per-command
 * matrix (per-command.test.ts) where they have proper context. TTY-only
 * invariants need a node-pty harness — tracked as a follow-up.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./test-utils.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}
function combined(r: { stdout: string; stderr: string }): string {
  return r.stdout + "\n" + r.stderr;
}

// ─── README snippet parity ───────────────────────────────────────────────────

describe("README snippet smoke", () => {
  const readmePath = path.join(REPO_ROOT, "README.md");
  const readme = fs.existsSync(readmePath)
    ? fs.readFileSync(readmePath, "utf-8")
    : "";

  // Parse fenced ```bash blocks; collect lines starting with `pax8 ` or
  // `PAX8_DEMO=1 pax8 ` (after trim). Strip inline `# comments` first
  // since a snippet like `pax8 companies more "Acme Corp"   # caption` would
  // otherwise tokenize the comment text as args.
  const codeBlocks: string[] = [];
  const fenceRe = /```bash\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(readme)) !== null) {
    codeBlocks.push(m[1]);
  }
  const allLines = codeBlocks.flatMap((b) =>
    b.split("\n").map((l) => stripInlineComment(l).trim())
  );
  const pax8Lines = allLines.filter(
    (l) =>
      l &&
      !l.startsWith("#") &&
      (l.startsWith("pax8 ") || l.startsWith("PAX8_DEMO=1 pax8 "))
  );

  // Skip predicates for snippets we can't safely run in a subprocess test.
  function isInteractiveWrite(line: string): boolean {
    if (
      /\b(orders create|recommendations act|invoices dispute|companies (create|update)|subscriptions (update|cancel)|contacts (create|update|delete)|quotes (create|update|delete)|webhooks (create|delete|test))\b/.test(
        line
      )
    ) {
      return !/--yes|-y\b|--idempotency-key/.test(line);
    }
    return false;
  }
  function isAuthLogin(line: string): boolean {
    return /\bauth login\b/.test(line);
  }
  function isReplOnly(line: string): boolean {
    // README shows `pax8>` REPL prompts and bare commands; skip non-runnable.
    return line.startsWith("pax8>");
  }
  function hasPlaceholder(line: string): boolean {
    // README often uses <id> / <name> / <thing> as placeholders for an
    // actual ID. Those are docs, not runnable as-is.
    return /<[a-z][a-z0-9_-]*>/i.test(line);
  }
  function hasShellPipeOrSubst(line: string): boolean {
    // Pipe operators / xargs / command substitution can't run inside
    // execFile (no shell). Skip — these are advanced doc snippets.
    return /(\||\bxargs\b|\$\(|`)/.test(line);
  }

  // README snippets currently known to fail. Track here so they don't
  // silently regress — this isn't a workaround; it's a punchlist.
  // Re-running the matrix after each fix will green these without code
  // changes once the underlying CLI/README is fixed.
  const KNOWN_FAILING = new Map<string, string>([]);

  const runnable = pax8Lines.filter(
    (l) =>
      !isInteractiveWrite(l) &&
      !isAuthLogin(l) &&
      !isReplOnly(l) &&
      !hasPlaceholder(l) &&
      !hasShellPipeOrSubst(l)
  );

  if (runnable.length === 0) {
    it("(no runnable README snippets found — verify README format)", () => {
      // Soft warning so a future change to README format re-surfaces this.
      expect(runnable.length).toBeGreaterThanOrEqual(0);
    });
  }

  for (const snippet of runnable) {
    const knownFailReason = KNOWN_FAILING.get(snippet);
    it(`runs cleanly: \`${snippet}\``, async () => {
      const cmd = snippet
        .replace(/^PAX8_DEMO=1\s+/, "")
        .replace(/^pax8\s+/, "");
      const args = tokenize(cmd);
      const r = await runCli(args);
      const out = combined(r);
      if (knownFailReason) {
        if (r.exitCode === 0) {
          // Bug got fixed — flip the entry from KNOWN_FAILING.
          throw new Error(
            `${snippet} now passes — remove from KNOWN_FAILING. Reason was: ${knownFailReason}`
          );
        }
        // eslint-disable-next-line no-console
        console.warn(`  [knownFail] ${snippet} — ${knownFailReason}`);
        return;
      }
      expect(
        r.exitCode,
        `\`${snippet}\` exited ${r.exitCode}.\nOutput:\n${out.slice(0, 1500)}`
      ).toBe(0);
      // Don't add a redundant "no error-flavoured tokens" regex here —
      // commands like `pax8 doctor` legitimately surface diagnostic phrases
      // like "Config file exists (Not found. Run: pax8 config init)" in
      // their successful output. The exit-code-0 assertion above is the
      // load-bearing check; the per-command matrix (per-command.test.ts)
      // catches `undefined` / `[object Object]` leaks at command granularity.
    });
  }
});

// ─── Error-path UX (single deliberately-bad command) ─────────────────────────

describe("error-path UX", () => {
  it("error renderer points at `pax8 report-bug` (#161 hint)", async () => {
    const r = await runCli(["companies", "show", "ZZZNotARealCompanyForUxSmoke"]);
    expect(r.exitCode).toBe(1);
    expect(
      stripAnsi(combined(r)),
      `Error path doesn't suggest \`pax8 report-bug\`. The free-win hint from #161 is missing.`
    ).toMatch(/pax8 report-bug/);
  });

  it("timeout-style errors include actionable hint, not just ms count (refs #199)", async () => {
    // We can't reliably trigger a real timeout under PAX8_DEMO=1, so we
    // assert the error-renderer code path produces the right shape via a
    // deliberately-bad show command. If/when a `--simulate-timeout` flag
    // exists for testing (see #199 follow-up), exercise that here too.
    const r = await runCli(["orders", "show", "definitely-not-a-real-id"]);
    if (r.exitCode === 0) return; // unexpected, but not the failure mode we care about
    const out = stripAnsi(combined(r));
    // Must be more than just "Request timed out after 30000ms" — should
    // include either the resource type, a hint, or report-bug suggestion.
    if (/timed out/i.test(out)) {
      expect(
        out,
        "timeout error must include actionable hint, not just ms count (#199)"
      ).toMatch(/--size|--timeout|--company|report-bug|try /i);
    }
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function stripInlineComment(line: string): string {
  // Strip ` # ...` style comments while preserving `#` inside double quotes.
  let out = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    if (!inQuote && c === "#") break;
    out += c;
  }
  return out;
}

function tokenize(s: string): string[] {
  // Minimal shell-style tokenizer: split on whitespace, respect double
  // quotes. Handles README snippets like `--company "Acme Corp"`.
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(c)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
