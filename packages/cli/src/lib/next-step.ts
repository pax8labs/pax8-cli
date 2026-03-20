import chalk from "chalk";
import { createInterface } from "readline";
import { execFile } from "child_process";

export interface NextStep {
  key: string;
  label: string;
  command: string[];
}

/**
 * Show a menu of next steps and let the user pick one by number.
 * Only shows in TTY mode. Runs the selected pax8 command as a child process.
 */
export async function promptNextSteps(steps: NextStep[]): Promise<void> {
  if (!process.stdin.isTTY) return;
  if (steps.length === 0) return;

  process.stderr.write(chalk.dim("  What's next?\n"));
  for (const step of steps) {
    process.stderr.write(`  ${chalk.cyan.bold(`[${step.key}]`)} ${step.label}\n`);
  }
  process.stderr.write(`  ${chalk.dim("[Enter]")} ${chalk.dim("Done")}\n`);
  process.stderr.write("\n");

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.dim("  > "), (a) => {
      rl.close();
      resolve(a.trim());
    });
  });

  if (!answer) return;

  const picked = steps.find((s) => s.key === answer);
  if (!picked) {
    process.stderr.write(chalk.dim("  (skipped)\n\n"));
    return;
  }

  process.stderr.write("\n");

  // Run the command, inheriting stdio so it renders inline
  return new Promise<void>((resolve) => {
    const child = execFile(picked.command[0], picked.command.slice(1), {
      timeout: 120_000,
      env: process.env,
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    // For interactive prompts, pipe stdin through
    if (process.stdin.isTTY) {
      process.stdin.pipe(child.stdin!);
    }
    child.on("close", () => resolve());
  });
}
