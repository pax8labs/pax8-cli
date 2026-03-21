import chalk from "chalk";
import { createInterface } from "readline";
import { spawn } from "child_process";

export interface NextStep {
  key: string;
  label: string;
  command: string[];
}

/**
 * Show a menu of next steps and let the user pick one by number.
 * Only shows in TTY mode. Runs the selected pax8 command inline.
 *
 * When running as a REPL child process (detected by PAX8_REPL env),
 * shows hints only — no interactive prompt, since stdin is shared.
 */
export async function promptNextSteps(steps: NextStep[]): Promise<void> {
  if (!process.stdin.isTTY) return;
  if (steps.length === 0) return;

  // In REPL mode, skip the interactive menu — stdin is shared with the REPL
  if (process.env.PAX8_REPL === "1") return;

  process.stderr.write(chalk.dim("  What's next?\n"));
  for (const step of steps) {
    const cmdHint = chalk.dim(step.command.join(" "));
    process.stderr.write(`  ${chalk.cyan.bold(`[${step.key}]`)} ${step.label}  ${cmdHint}\n`);
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

  // Run the command with inherited stdio so interactive prompts work
  return new Promise<void>((resolve) => {
    const child = spawn(picked.command[0], picked.command.slice(1), {
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", () => resolve());
  });
}
