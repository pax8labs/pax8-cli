// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";
import { createInterface } from "readline";
import { spawn } from "child_process";

export interface NextStep {
  key: string;
  label: string;
  /** Command args WITHOUT the "pax8" prefix — e.g. ["subscriptions", "renewals"] */
  command: string[];
}

/**
 * Prompt the user to drill into a numbered row from the most-recent table.
 * Only interactive in TTY mode. Skips silently when piped.
 *
 * The table itself is the menu — every row already shows its index in the
 * `#` column — so we don't re-print each option here. We just show one
 * concise hint with a representative example, then read input.
 */
export async function promptNextSteps(steps: NextStep[]): Promise<void> {
  if (!process.stdin.isTTY) return;
  if (steps.length === 0) return;

  // Pick a sample row to illustrate "what does typing a number do?"
  // First row is representative for any list-style table.
  const sample = steps[0];
  const max = steps[steps.length - 1].key;

  process.stderr.write(
    "  " +
      chalk.dim(
        `Type 1-${max} to drill in (e.g. \`${sample.key}\` → ${sample.label.split(" — ")[0]}), or press Enter to skip.`
      ) +
      "\n\n"
  );

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.dim("  > "), (a) => {
      rl.close();
      resolve(a.trim());
    });
  });

  if (!answer) return;

  const picked = steps.find((s) => s.key === answer);
  if (!picked) return;

  process.stderr.write("\n");

  return new Promise<void>((resolve, _reject) => {
    const child = spawn("pax8", picked.command, {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", () => resolve()); // don't crash on spawn failure
    child.on("close", () => resolve());
  });
}
