// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { createInterface } from "readline";
import chalk from "chalk";

function shouldAutoConfirm(): boolean {
  return (
    process.env.PAX8_YES === "1" ||
    process.argv.includes("--yes") ||
    process.argv.includes("-y")
  );
}

/** Check if running inside the pax8 REPL. */
export function isReplMode(): boolean {
  return process.env.PAX8_REPL === "1";
}

/** Strip "pax8 " prefix from a command string when running in REPL mode. */
export function replCmd(cmd: string): string {
  if (isReplMode() && cmd.startsWith("pax8 ")) {
    return cmd.slice(5);
  }
  return cmd;
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function confirm(
  message: string,
  options?: { default?: boolean }
): Promise<boolean> {
  if (shouldAutoConfirm()) return true;

  const defaultVal = options?.default ?? false;
  const hint = defaultVal ? "[y/n]" : "[y/n]";
  const answer = await prompt(`  ${message} ${hint} `);

  if (answer === "") return defaultVal;
  return answer.toLowerCase().startsWith("y");
}

/**
 * Confirm with an option to edit a numeric value (e.g. quantity).
 * Returns the confirmed value, or null if cancelled.
 *
 * Prompt is `[y/n/e]` where the letters mean:
 *   y — accept the current value (also: empty enter = accept)
 *   n — reject (returns null) — readable as "no" or "cancel"
 *   e — edit the value, then re-confirm
 *
 * The historical letter was `c` (for "change"), which read as "cancel"
 * to many partners and produced an inverted-intent gotcha (typing what
 * felt like "abort" actually entered the edit flow). `e` removes the
 * ambiguity — same shape, clearer meaning.
 */
export async function confirmWithChange(
  message: string,
  currentValue: number,
  options?: { label?: string }
): Promise<number | null> {
  if (shouldAutoConfirm()) return currentValue;

  const answer = await prompt(`  ${message} [y/n/e] `);
  const a = answer.toLowerCase();

  if (a === "e" || a === "edit") {
    const label = options?.label ?? "Quantity";
    const newAnswer = await prompt(`  ${label}? [${currentValue}] `);
    if (newAnswer === "") return currentValue;
    const parsed = parseInt(newAnswer, 10);
    if (isNaN(parsed) || parsed <= 0) return null;
    // Re-confirm with new value
    const reconfirm = await prompt(`  ${message.replace(String(currentValue), String(parsed))} [y/n] `);
    if (reconfirm !== "" && !reconfirm.toLowerCase().startsWith("y")) return null;
    return parsed;
  }

  if (a === "" || a.startsWith("y")) return currentValue;
  return null;
}

/**
 * Look for an explicit `PAX8_CONFIRM_DESTRUCTIVE=<keyword>` in env.
 * Non-interactive escape hatch for automation that wants to satisfy
 * the keyword challenge without a TTY prompt — the caller must spell
 * out the keyword, demonstrating they read what the command does.
 * `--yes` / `PAX8_YES` alone is not enough.
 *
 * Env var (not a CLI flag) because adding a per-command flag would
 * require Commander option registration on every destructive command
 * and a chunk of help-text duplication. Shell users prefix their
 * invocation: `PAX8_CONFIRM_DESTRUCTIVE=cancel pax8 subscriptions ...`.
 */
function getDestructiveKeywordOverride(): string | null {
  const envKey = process.env.PAX8_CONFIRM_DESTRUCTIVE;
  if (typeof envKey === "string" && envKey.length > 0) return envKey;
  return null;
}

export async function confirmDestructive(
  message: string,
  keyword: string
): Promise<boolean> {
  // H-5: the typed-keyword challenge intentionally ignores --yes /
  // PAX8_YES. Destructive operations (delete, cancel) need a stronger
  // gate than a boolean flag can satisfy — partners and agents must
  // demonstrate explicit intent by typing the keyword. Pre-H-5 the
  // `if (shouldAutoConfirm())` early return silently downgraded the
  // keyword challenge to a single-flag bypass, defeating the
  // function's name and the skill manifest's "writes are deliberate"
  // commitment.
  //
  // Three resolution paths in priority order:
  //   1. `PAX8_CONFIRM_DESTRUCTIVE=<keyword>` in env explicitly spells
  //      out the keyword — automation's path.
  //   2. Interactive TTY: prompt for the keyword. Works under --yes too
  //      (the prompt still fires; the user still has to type).
  //   3. Non-TTY without the override: refuse with a stderr message.
  //      Far better than hanging on a prompt nobody can answer, and
  //      far better than auto-confirming.
  const override = getDestructiveKeywordOverride();
  if (override !== null) {
    return override === keyword;
  }

  if (!process.stdin.isTTY) {
    process.stderr.write(
      chalk.red(
        `\n  ✗ Destructive operation requires the typed-keyword challenge.\n`
      ) +
      chalk.dim(
        `    --yes / PAX8_YES does not bypass destructive confirmation —\n` +
        `    that's by design (see security finding H-5).\n` +
        `    For automation: prefix with PAX8_CONFIRM_DESTRUCTIVE=${keyword}\n` +
        `    For interactive use: run on a TTY and type "${keyword}" at the prompt.\n\n`
      )
    );
    return false;
  }

  const answer = await prompt(
    `  ${message}\n  Type "${keyword}" to confirm: `
  );

  return answer === keyword;
}
