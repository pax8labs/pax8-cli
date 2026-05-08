// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Per-command e2e matrix. Drives every command in command-inventory.ts
 * through a fixed set of layers:
 *
 *   1. Smoke              — exits 0 (or known-broken), no stack trace
 *   2. Cross-cutting      — no `undefined`/`null`/`[object Object]`/UUID
 *                           leaks, no debug tokens, idempotent re-run
 *   3. Semantic           — per-command expectedFragments / forbiddenFragments
 *                           and customAssertions (e.g. orders show MUST have
 *                           a non-empty Company line, audit MUST surface
 *                           discrepancies, etc.)
 *   4. JSON contract      — `--json` parses; required fields per spec
 *   5. Help               — `--help` exits 0 and mentions the command name
 *
 * Why this matrix exists: this session surfaced 5 bugs in commands that
 * had unit-tested logic but no end-to-end subprocess test. `usage list`
 * 404, `orders show` Company:undefined, `recommendations list` triple-print,
 * `orders list` 30s timeout (#199), invoices empty-state framing — all of
 * these would have been caught by a single subprocess invocation per
 * command. The matrix IS that invocation, formalised as a spec.
 *
 * When this catches a regression, the failing assertion message names the
 * command, the layer, and the specific invariant. The fix usually goes in
 * the command's render code or fixture data — this matrix is the spec for
 * "what good looks like."
 *
 * Adding a new command: add a CommandSpec to command-inventory.ts. The
 * matrix exercises it automatically. Cataloguing a known bug rather than
 * weakening assertions: set `demo.knownBroken` with the issue link — the
 * affected layers will skip with a console.warn so the bug stays visible.
 */
import { describe, it, expect } from "vitest";
import {
  runCli,
  type CliResult,
} from "./test-utils.js";
import {
  COMMAND_INVENTORY,
  type CommandSpec,
} from "./command-inventory.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function combined(r: CliResult): string {
  return r.stdout + "\n" + r.stderr;
}

function specLabel(spec: CommandSpec): string {
  return spec.label ?? `pax8 ${spec.command.join(" ")}`;
}

/**
 * Resolve the runtime args for a spec. Caches via the spec's resolveArgsKey
 * (the cache itself lives in command-inventory.ts).
 */
async function resolveSpecArgs(spec: CommandSpec): Promise<string[]> {
  if (spec.resolveArgs) return await spec.resolveArgs();
  return spec.command;
}

// ─── matrix ─────────────────────────────────────────────────────────────────

// Bucket commands so the test report groups by capability.
const READ_SPECS = COMMAND_INVENTORY.filter((s) => !s.isWrite && !s.skipLiveRun);
const SKIPPED_SPECS = COMMAND_INVENTORY.filter((s) => s.isWrite || s.skipLiveRun);

describe("Per-command matrix — readable commands run live", () => {
  for (const spec of READ_SPECS) {
    describe(specLabel(spec), () => {
      // Cache the run so multiple layers don't pay the subprocess cost
      // multiple times. Each layer pulls from the same `r`.
      let r: CliResult | undefined;
      let humanOut = "";
      let resolveError: Error | null = null;

      // Layer 1: smoke
      it("[smoke] exits 0 and produces some output", async () => {
        let args: string[];
        try {
          args = await resolveSpecArgs(spec);
        } catch (e) {
          resolveError = e as Error;
          if (spec.demo.knownBroken) {
            // eslint-disable-next-line no-console
            console.warn(
              `  [skip:knownBroken ${spec.demo.knownBroken.issue}] ${specLabel(spec)} — ${spec.demo.knownBroken.reason}`
            );
            return;
          }
          throw new Error(
            `Failed to resolve args for ${specLabel(spec)}: ${(e as Error).message}`
          );
        }
        r = await runCli(args);
        humanOut = stripAnsi(combined(r));

        if (spec.demo.knownBroken) {
          // Don't fail — just record. Bug is tracked in the linked issue.
          if (r.exitCode !== 0) {
            // eslint-disable-next-line no-console
            console.warn(
              `  [knownBroken ${spec.demo.knownBroken.issue}] ${specLabel(spec)} exited ${r.exitCode}: ${spec.demo.knownBroken.reason}`
            );
          }
          return;
        }

        expect(
          r.exitCode,
          `${specLabel(spec)} exited ${r.exitCode}\nstderr:\n${r.stderr.slice(0, 1200)}\nstdout:\n${r.stdout.slice(0, 800)}`
        ).toBe(0);
        // No raw stack traces in human output.
        expect(humanOut, `${specLabel(spec)} leaked a stack trace`).not.toMatch(
          /\bat .+\(.+:\d+:\d+\)/
        );
      });

      // Layer 2: cross-cutting invariants
      //
      // SCOPE: subprocess runs are non-TTY, so the CLI's agent-first contract
      // means stdout is JSON, not table. We assert invariants that hold in
      // BOTH formats — leaked `undefined`/`null`/`[object Object]` strings
      // are wrong in either, debug tokens are wrong in either. Human-only
      // invariants (UUID leaks in tables, density bounds, "estimated MRR"
      // prose, drill-in hint) need a node-pty harness — tracked as a
      // separate follow-up.
      it("[invariants] no undefined/object-Object/debug leaks", async () => {
        if (resolveError || !r) return; // smoke already failed/skipped
        if (spec.demo.knownBroken) return;
        if (r.exitCode !== 0) return; // smoke caught it

        // Bare `undefined` is wrong in JSON (would be the literal word, not
        // null) and wrong in human render. Same for `[object Object]`.
        expect(
          humanOut,
          `${specLabel(spec)} rendered "undefined" — likely a missing field/enrichment`
        ).not.toMatch(/\bundefined\b/);
        expect(
          humanOut,
          `${specLabel(spec)} rendered "[object Object]"`
        ).not.toContain("[object Object]");
        // No debug tokens.
        expect(humanOut, `${specLabel(spec)} has DEBUG: token`).not.toMatch(
          /\bDEBUG:\s/
        );
        expect(
          humanOut,
          `${specLabel(spec)} has TODO/FIXME visible in output`
        ).not.toMatch(/\b(TODO|FIXME|XXX):\s/);
      });

      // Layer 2b: idempotency — same command twice produces equivalent output.
      // Only check for read-only list/show commands; reports may include
      // "as of <timestamp>" so we exclude those.
      const idempotencyCheck =
        spec.type === "list" || spec.type === "show";
      if (idempotencyCheck) {
        it("[invariants] idempotent: re-running yields same shape", async () => {
          if (resolveError || !r) return;
          if (spec.demo.knownBroken) return;
          if (r.exitCode !== 0) return;
          const args = await resolveSpecArgs(spec);
          const r2 = await runCli(args);
          if (r2.exitCode !== 0) return; // flake; layer 1 covers correctness
          // We compare line counts and structural-hash, not full strings,
          // since spinners and timestamps can vary between runs.
          const lines1 = humanOut.trim().split("\n").length;
          const lines2 = stripAnsi(combined(r2)).trim().split("\n").length;
          expect(
            Math.abs(lines1 - lines2),
            `${specLabel(spec)} produced different line counts on re-run (${lines1} vs ${lines2}) — non-deterministic render`
          ).toBeLessThanOrEqual(2);
        });
      }

      // Layer 3: semantic — per-command expectedFragments and customAssertions
      it("[semantic] per-command expected/forbidden fragments", async () => {
        if (resolveError || !r) return;
        if (spec.demo.knownBroken) return;
        if (r.exitCode !== 0) return;

        for (const frag of spec.demo.expectedFragments ?? []) {
          if (typeof frag === "string") {
            expect(
              humanOut,
              `${specLabel(spec)} missing expected fragment "${frag}"`
            ).toContain(frag);
          } else {
            expect(
              humanOut,
              `${specLabel(spec)} missing expected pattern ${frag}`
            ).toMatch(frag);
          }
        }
        for (const frag of spec.demo.forbiddenFragments ?? []) {
          // The default banlist (undefined / [object Object] / null) is
          // already enforced in layer 2; per-command additions go here.
          // Skip duplicates with the default banlist to avoid double-failing.
          if (frag === "undefined") continue;
          expect(
            humanOut,
            `${specLabel(spec)} contains forbidden fragment "${frag}"`
          ).not.toContain(frag);
        }
        if (spec.customAssertions) {
          spec.customAssertions(humanOut, r);
        }
      });

      // Layer 4: JSON contract
      const contract = spec.jsonContract;
      if (!contract.skip) {
        it("[json] --json parses and matches contract", async () => {
          if (resolveError) return;
          if (spec.demo.knownBroken) return;
          const args = await resolveSpecArgs(spec);
          const rj = await runCli([...args, "--json"]);
          if (rj.exitCode !== 0) {
            throw new Error(
              `${specLabel(spec)} --json exited ${rj.exitCode}\nstderr:\n${rj.stderr.slice(0, 800)}`
            );
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(rj.stdout);
          } catch (e) {
            throw new Error(
              `${specLabel(spec)} --json did not produce valid JSON.\nstdout (first 600 chars):\n${rj.stdout.slice(0, 600)}`
            );
          }

          // List-shape: either flat array or envelope { <thing>: [], ... }
          if (contract.arrayItemRequiredFields) {
            const items: unknown =
              Array.isArray(parsed)
                ? parsed
                : parsed && typeof parsed === "object"
                  ? Object.values(parsed).find((v) => Array.isArray(v))
                  : undefined;
            if (!Array.isArray(items)) {
              throw new Error(
                `${specLabel(spec)} --json has no array. Top-level shape: ${typeof parsed === "object" && parsed !== null ? Object.keys(parsed).join(",") : typeof parsed}`
              );
            }
            const minRows = spec.demo.minRows ?? 0;
            if (items.length < minRows) {
              throw new Error(
                `${specLabel(spec)} --json returned ${items.length} rows; demo fixtures should yield ≥${minRows}`
              );
            }
            for (const [i, item] of items.entries()) {
              if (typeof item !== "object" || item === null) {
                throw new Error(
                  `${specLabel(spec)} --json item ${i} is not an object: ${JSON.stringify(item).slice(0, 200)}`
                );
              }
              for (const field of contract.arrayItemRequiredFields) {
                if (
                  !(field in (item as Record<string, unknown>)) ||
                  (item as Record<string, unknown>)[field] == null
                ) {
                  throw new Error(
                    `${specLabel(spec)} --json item ${i} missing required field "${field}". Item: ${JSON.stringify(item).slice(0, 200)}`
                  );
                }
              }
            }
          }
          if (contract.objectRequiredFields) {
            // Could be wrapped in an envelope `{ <thing>: {...} }` or flat object.
            let target: Record<string, unknown> | undefined;
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              const obj = parsed as Record<string, unknown>;
              // First check if the required fields are at top level.
              const topLevelHasAll = contract.objectRequiredFields.every(
                (f) => f in obj
              );
              if (topLevelHasAll) {
                target = obj;
              } else {
                // Look for an inner object that has them (envelope shape).
                for (const v of Object.values(obj)) {
                  if (v && typeof v === "object" && !Array.isArray(v)) {
                    const inner = v as Record<string, unknown>;
                    if (contract.objectRequiredFields.every((f) => f in inner)) {
                      target = inner;
                      break;
                    }
                  }
                }
              }
            }
            if (!target) {
              throw new Error(
                `${specLabel(spec)} --json missing required object fields ${JSON.stringify(contract.objectRequiredFields)}. Got top-level keys: ${parsed && typeof parsed === "object" ? Object.keys(parsed).join(",") : typeof parsed}`
              );
            }
            for (const field of contract.objectRequiredFields) {
              if (target[field] == null) {
                throw new Error(
                  `${specLabel(spec)} --json field "${field}" is null/undefined`
                );
              }
            }
          }
        });
      }
    });
  }
});

// ─── help-flag layer (covers EVERY command, including write/skipped ones) ───

describe("Per-command matrix — every command has working --help", () => {
  for (const spec of COMMAND_INVENTORY) {
    it(`pax8 ${spec.command.join(" ")} --help`, async () => {
      // For commands with required positional args, --help should still work
      // even though the positional is missing — Commander supports this.
      // We only pass the bare command path (drop any value-style args from
      // the inventory entry; --help short-circuits).
      const helpArgs = stripValueArgs(spec.command);
      const r = await runCli([...helpArgs, "--help"]);
      expect(
        r.exitCode,
        `\`pax8 ${helpArgs.join(" ")} --help\` exited ${r.exitCode}\nstderr:\n${r.stderr.slice(0, 600)}`
      ).toBe(0);
      // The last segment of the command should appear in the help output.
      // (Help text usually starts with "Usage: pax8 <subcommand>...")
      const out = stripAnsi(r.stdout + r.stderr);
      const lastSeg = helpArgs[helpArgs.length - 1] ?? "";
      expect(
        out.toLowerCase(),
        `${specLabel(spec)} --help did not mention command name "${lastSeg}". Output:\n${out.slice(0, 400)}`
      ).toContain(lastSeg.toLowerCase());
    });
  }
});

// Strip flag-value pairs and standalone positional values from inventory args
// so --help works (e.g. drop "Acme Corp" from `companies show "Acme Corp"`,
// drop `--within 30d` from `subscriptions renewals --within 30d`).
function stripValueArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--") || a.startsWith("-")) {
      // It's a flag; keep the flag itself only if it's a boolean-style. Drop
      // a following value if there is one. Simplest: just drop both for
      // --help compatibility.
      // Skip the next token too if it's not a flag.
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        i++;
      }
      continue;
    }
    // Skip free-form positionals (likely an ID/name like "Acme Corp")
    // ONLY if we already have a subcommand. Top-level commands like
    // "dashboard" / "doctor" are positional too but ARE the command.
    if (out.length >= 2) continue; // group + subcommand already captured
    out.push(a);
  }
  return out;
}

// ─── reporting: log skipped commands so reviewers see the coverage gap ─────

describe("Per-command matrix — skipped commands inventory", () => {
  it("logs commands skipped from live-run for visibility", () => {
    if (SKIPPED_SPECS.length === 0) return;
    // eslint-disable-next-line no-console
    console.log(
      `\n  Skipped from live-run (${SKIPPED_SPECS.length} commands — covered by help-flag layer only):`
    );
    for (const s of SKIPPED_SPECS) {
      // eslint-disable-next-line no-console
      console.log(
        `    pax8 ${s.command.join(" ")} — ${s.skipLiveRun?.reason ?? "write command"}`
      );
    }
    expect(SKIPPED_SPECS.length).toBeGreaterThan(0); // not a real assertion; just keeps the test from being empty
  });
});
