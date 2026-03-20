import chalk from "chalk";
import type { Ora } from "ora";

export class CliError extends Error {
  constructor(
    message: string,
    public causes?: string[],
    public recoverySteps?: string[],
    public docsUrl?: string
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function handleCommandError(
  error: unknown,
  spinner?: Ora,
  context?: string
): never {
  // Stop spinner if active
  if (spinner) {
    try {
      spinner.fail();
    } catch {
      // Spinner may already be stopped
    }
  }

  const prefix = context ? `${context}: ` : "";

  if (error instanceof CliError) {
    process.stderr.write(
      chalk.red.bold(`\n  ✗ ${prefix}${error.message}\n`)
    );

    if (error.causes && error.causes.length > 0) {
      process.stderr.write(chalk.dim("\n  Causes:\n"));
      for (const cause of error.causes) {
        process.stderr.write(chalk.dim(`    • ${cause}\n`));
      }
    }

    if (error.recoverySteps && error.recoverySteps.length > 0) {
      process.stderr.write(chalk.yellow("\n  Recovery steps:\n"));
      for (const step of error.recoverySteps) {
        process.stderr.write(chalk.yellow(`    → ${step}\n`));
      }
    }

    if (error.docsUrl) {
      process.stderr.write(
        chalk.dim(`\n  Docs: ${error.docsUrl}\n`)
      );
    }

    process.stderr.write("\n");
  } else if (error instanceof Error) {
    process.stderr.write(
      chalk.red.bold(`\n  ✗ ${prefix}${error.message}\n\n`)
    );
  } else {
    process.stderr.write(
      chalk.red.bold(`\n  ✗ ${prefix}An unexpected error occurred\n\n`)
    );
  }

  process.exit(1);

  // If process.exit was overridden (e.g. REPL mode), throw to stop execution.
  // This ensures the `never` return type contract is honored.
  throw new Error("process.exit intercepted");
}
