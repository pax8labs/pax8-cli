// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";
import { createInterface } from "readline";
import { spawn } from "child_process";
import { resolveCliPath } from "./repl.js";

export interface NextStep {
  key: string;
  label: string;
  /** Command args WITHOUT the "pax8" prefix — e.g. ["subscriptions", "renewals"] */
  command: string[];
}

/**
 * Prompt the user to drill into a numbered option. Only interactive in TTY
 * mode. Skips silently when piped.
 *
 * Two rendering modes, controlled by `options.renderList`:
 *
 *   1. **Headless** (default — `renderList` false or absent): the caller
 *      is responsible for printing the menu, typically as a numbered table
 *      above this prompt. Used by `recommendations list`, `companies list`,
 *      etc. — every row already shows its index in the `#` column, so we
 *      don't re-print each option, just show one concise drill-in hint.
 *
 *   2. **Embedded list** (`renderList: true`): no table above. We print
 *      every step as `  N. label` before the prompt so the user has
 *      something to pick from. Used by `dashboard` (Quick Actions block)
 *      and `subscriptions renewals` (`Try next:` block).
 */
export async function promptNextSteps(
  steps: NextStep[],
  options?: { renderList?: boolean },
): Promise<void> {
  if (!process.stdin.isTTY) return;
  if (steps.length === 0) return;

  // Embedded-list mode: print each option before the prompt. Otherwise the
  // prompt below references a "1-N" range with no visible menu (the bug
  // the dashboard's Quick Actions block hit pre-this-fix).
  if (options?.renderList) {
    for (const step of steps) {
      process.stderr.write(`  ${chalk.dim(`${step.key}.`)} ${step.label}\n`);
    }
    process.stderr.write("\n");
  }

  // Pick a sample row to illustrate "what does typing a number do?"
  // First row is representative for any list-style menu.
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

  // #457: reuse the active CLI entrypoint instead of hardcoding `pax8` on
  // PATH. The REPL already does this via `resolveCliPath(process.argv[1])`
  // (see lib/repl.ts) — drill-in from a non-PATH launch (`node dist/index.js`,
  // a yarn -g install in an unusual prefix, etc.) was the only remaining
  // call site that assumed `pax8` was discoverable.
  let cliPath: string;
  try {
    cliPath = resolveCliPath(process.argv[1]);
  } catch {
    // Best-effort fallback to the legacy behavior when we can't resolve
    // process.argv[1] (e.g. embedded callers in a future MCP wrapper).
    return new Promise<void>((resolve) => {
      const child = spawn("pax8", picked.command, {
        stdio: "inherit",
        env: process.env,
      });
      child.on("error", () => resolve());
      child.on("close", () => resolve());
    });
  }

  return new Promise<void>((resolve, _reject) => {
    const child = spawn("node", [cliPath, ...picked.command], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", () => resolve()); // don't crash on spawn failure
    child.on("close", () => resolve());
  });
}
