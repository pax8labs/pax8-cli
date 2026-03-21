import chalk from "chalk";
import { ZodError } from "zod";
import type { Ora } from "ora";
import { ApiError } from "@pax8/core";

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

/**
 * Format a ZodError into a human-readable message.
 */
function formatZodError(error: ZodError): string {
  return error.issues
    .map((i) => {
      const path = i.path.length > 0 ? `"${i.path.join(".")}"` : "response";
      return `${path}: expected ${(i as { expected?: string }).expected ?? i.code}, got ${(i as { received?: string }).received ?? "something else"}`;
    })
    .join("; ");
}

function extractErrorDetail(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  // Pax8 API errors may use "message", "error", "detail", or "error_description"
  for (const key of ["message", "error", "detail", "error_description"]) {
    if (typeof b[key] === "string" && b[key]) return b[key] as string;
  }
  // Nested under "error" object
  if (typeof b.error === "object" && b.error !== null) {
    const inner = b.error as Record<string, unknown>;
    if (typeof inner.message === "string") return inner.message;
  }
  return undefined;
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

  const prefix = context ? `${context}\n` : "";

  if (error instanceof CliError) {
    process.stderr.write(
      chalk.red.bold(`\n  ✗ ${prefix}  ${error.message}\n`)
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
  } else if (error instanceof ZodError) {
    // Zod validation errors mean the API returned an unexpected shape
    process.stderr.write(
      chalk.red.bold(`\n  ✗ ${prefix}`) +
      chalk.red(`  The Pax8 API returned an unexpected response.\n`) +
      chalk.dim(`    ${formatZodError(error)}\n\n`) +
      chalk.yellow(`    → This usually means no data was found, or the API format has changed.\n`) +
      chalk.yellow(`    → Try a different query, or run ${chalk.cyan("pax8 doctor")} to check your setup.\n\n`)
    );
  } else if (error instanceof ApiError) {
    process.stderr.write(
      chalk.red.bold(`\n  ✗ ${prefix}  ${error.message}\n\n`)
    );
    if (error.statusCode === 401 || error.statusCode === 403) {
      process.stderr.write(
        chalk.yellow(`    → Your credentials may have expired. Run ${chalk.cyan("pax8 auth login")} to re-authenticate.\n\n`)
      );
    } else if (error.statusCode === 404) {
      const detail = extractErrorDetail(error.responseBody);
      if (detail) {
        process.stderr.write(chalk.yellow(`    → ${detail}\n\n`));
      } else {
        process.stderr.write(
          chalk.yellow(`    → The resource was not found. Check the ID or name and try again.\n\n`)
        );
      }
    }
  } else if (error instanceof Error) {
    process.stderr.write(
      chalk.red.bold(`\n  ✗ ${prefix}  ${error.message}\n\n`)
    );
  } else {
    process.stderr.write(
      chalk.red.bold(`\n  ✗ ${prefix}  An unexpected error occurred\n\n`)
    );
  }

  process.exit(1);

  // If process.exit was overridden (e.g. REPL mode), throw to stop execution.
  // This ensures the `never` return type contract is honored.
  throw new Error("process.exit intercepted");
}
