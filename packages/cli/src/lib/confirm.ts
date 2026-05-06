// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { createInterface } from "readline";

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
 * Confirm with an option to change a numeric value (e.g. quantity).
 * Returns the confirmed value, or null if cancelled.
 * [y] confirms default, [c] prompts for new value, [n] cancels.
 */
export async function confirmWithChange(
  message: string,
  currentValue: number,
  options?: { label?: string }
): Promise<number | null> {
  if (shouldAutoConfirm()) return currentValue;

  const answer = await prompt(`  ${message} [y/n/c] `);
  const a = answer.toLowerCase();

  if (a === "c" || a === "change") {
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

export async function confirmDestructive(
  message: string,
  keyword: string
): Promise<boolean> {
  if (shouldAutoConfirm()) return true;

  const answer = await prompt(
    `  ${message}\n  Type "${keyword}" to confirm: `
  );

  return answer === keyword;
}
