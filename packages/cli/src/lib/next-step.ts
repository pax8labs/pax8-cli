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
 * Show a numbered menu of next steps, prompt the user to pick one, and run it.
 * Only interactive in TTY mode. Skips silently when piped.
 */
export async function promptNextSteps(steps: NextStep[]): Promise<void> {
  if (!process.stdin.isTTY) return;
  if (steps.length === 0) return;

  for (const step of steps) {
    process.stderr.write(`  ${chalk.cyan.bold(`[${step.key}]`)} ${step.label}\n`);
    process.stderr.write(chalk.dim(`      ${step.command.join(" ")}\n`));
  }
  process.stderr.write("\n");

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.dim("  Enter # to run, or press Enter to skip: "), (a) => {
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
