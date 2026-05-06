import chalk from "chalk";
import { ZodError, ZodIssueCode } from "zod";
import type { Ora } from "ora";
import {
  ApiError,
  ERROR_API_TIMEOUT,
  ERROR_API_VALIDATION,
  ERROR_AUTH_EXPIRED,
  ERROR_COMPANY_NOT_FOUND,
  ERROR_INTERNAL,
  ERROR_NOT_AUTHORIZED,
  ERROR_PRODUCT_NOT_FOUND,
  ERROR_RATE_LIMITED,
  ERROR_SUBSCRIPTION_NOT_FOUND,
  getTelemetry,
  type Pax8ErrorCode,
} from "@pax8/core";
import { replCmd } from "./confirm.js";

/**
 * Flush buffered telemetry and shut down the PostHog client before the CLI
 * exits. Bounded by a 2s timeout so a hung egress can never stall the user.
 * No-op fast path when telemetry is disabled (the default), so opt-out users
 * pay nothing for this guarantee. Errors are swallowed — telemetry must
 * never crash the CLI.
 *
 * Exported so the top-level signal/error handlers in `index.ts` can reuse
 * the same flush-before-exit semantics.
 *
 * See #145 — without this, the in-memory PostHog buffer was being dropped
 * by `process.exit(1)` on every error path, making PostHog dashboards
 * report ~100% success regardless of reality.
 */
export async function flushTelemetryBeforeExit(timeoutMs = 2000): Promise<void> {
  try {
    await getTelemetry().flushAndShutdown(timeoutMs);
  } catch {
    // Telemetry must never crash the CLI.
  }
}

export class CliError extends Error {
  constructor(
    message: string,
    public causes?: string[],
    public recoverySteps?: string[],
    public docsUrl?: string,
    public code?: Pax8ErrorCode,
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
      if (i.code === ZodIssueCode.invalid_type) {
        return `${path}: expected ${i.expected}, got ${i.received}`;
      }
      if (i.code === ZodIssueCode.invalid_literal) {
        return `${path}: expected ${String(i.expected)}, got ${String(i.received)}`;
      }
      if (i.code === ZodIssueCode.invalid_enum_value) {
        return `${path}: expected one of ${i.options.join(", ")}, got ${i.received}`;
      }
      if (i.code === ZodIssueCode.invalid_union_discriminator) {
        return `${path}: expected one of ${i.options.join(", ")}`;
      }
      return `${path}: ${i.code} — ${i.message}`;
    })
    .join("; ");
}

export function extractErrorDetail(body: unknown): string | undefined {
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

/**
 * Detect whether the global `--json` flag is set. We check argv directly
 * because handleCommandError is often invoked from a `catch` block where the
 * Commander context isn't available, and because we want JSON envelope output
 * even for errors that fire before `buildContext()` succeeds.
 */
function isJsonOutputRequested(): boolean {
  return process.argv.includes("--json");
}

/**
 * Map an ApiError to a stable error code based on status + message hints.
 */
function codeForApiError(error: ApiError): Pax8ErrorCode {
  const status = error.statusCode;
  if (status === 401 || status === 403) return ERROR_AUTH_EXPIRED;
  if (status === 408) return ERROR_API_TIMEOUT;
  if (status === 429) return ERROR_RATE_LIMITED;
  if (status >= 500) return ERROR_INTERNAL;
  if (status === 404) {
    const haystack = (
      error.message +
      " " +
      (typeof error.requestPath === "string" ? error.requestPath : "")
    ).toLowerCase();
    if (haystack.includes("company") || haystack.includes("companies")) {
      return ERROR_COMPANY_NOT_FOUND;
    }
    if (haystack.includes("product")) {
      return ERROR_PRODUCT_NOT_FOUND;
    }
    if (haystack.includes("subscription")) {
      return ERROR_SUBSCRIPTION_NOT_FOUND;
    }
    return ERROR_NOT_AUTHORIZED;
  }
  return ERROR_INTERNAL;
}

interface ErrorEnvelope {
  code?: Pax8ErrorCode;
  message: string;
  causes?: string[];
  recoverySteps?: string[];
  docsUrl?: string;
}

/**
 * Build the JSON envelope for a thrown error. Omits fields that aren't set so
 * consumers don't have to special-case `null`.
 */
function buildErrorEnvelope(error: unknown, context?: string): ErrorEnvelope {
  const prefix = context ? `${context}: ` : "";

  if (error instanceof CliError) {
    const env: ErrorEnvelope = { message: prefix + error.message };
    if (error.code) env.code = error.code;
    if (error.causes && error.causes.length > 0) env.causes = error.causes;
    if (error.recoverySteps && error.recoverySteps.length > 0) {
      env.recoverySteps = error.recoverySteps;
    }
    if (error.docsUrl) env.docsUrl = error.docsUrl;
    return env;
  }

  if (error instanceof ZodError) {
    return {
      code: ERROR_API_VALIDATION,
      message:
        prefix +
        "The Pax8 API returned an unexpected response.",
      causes: [formatZodError(error)],
      recoverySteps: [
        "Try a different query, or run pax8 doctor to check your setup.",
      ],
    };
  }

  if (error instanceof ApiError) {
    const env: ErrorEnvelope = {
      code: codeForApiError(error),
      message: prefix + error.message,
    };
    const detail = extractErrorDetail(error.responseBody);
    if (detail) env.causes = [detail];
    if (error.statusCode === 401 || error.statusCode === 403) {
      env.recoverySteps = [
        "Your credentials may have expired. Run pax8 auth login to re-authenticate.",
      ];
    }
    return env;
  }

  if (error instanceof Error) {
    return {
      code: ERROR_INTERNAL,
      message: prefix + error.message,
    };
  }

  return {
    code: ERROR_INTERNAL,
    message: prefix + "An unexpected error occurred",
  };
}

export async function handleCommandError(
  error: unknown,
  spinner?: Ora,
  context?: string,
): Promise<never> {
  // Stop spinner if active
  if (spinner) {
    try {
      spinner.fail();
    } catch {
      // Spinner may already be stopped
    }
  }

  // Machine-readable JSON envelope when --json is set
  if (isJsonOutputRequested()) {
    const envelope = buildErrorEnvelope(error, context);
    process.stderr.write(JSON.stringify(envelope, null, 2) + "\n");
    // Flush telemetry before exit (#145) so failure events actually reach
    // PostHog. Bounded by a 2s timeout in flushAndShutdown.
    await flushTelemetryBeforeExit();
    process.exit(1);

    // Honor never return contract when process.exit is mocked
    throw new Error("process.exit intercepted");
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
      chalk.yellow(`    → Try a different query, or run ${chalk.cyan(replCmd("pax8 doctor"))} to check your setup.\n\n`)
    );
  } else if (error instanceof ApiError) {
    process.stderr.write(
      chalk.red.bold(`\n  ✗ ${prefix}  ${error.message}\n\n`)
    );
    if (error.statusCode === 401 || error.statusCode === 403) {
      process.stderr.write(
        chalk.yellow(`    → Your credentials may have expired. Run ${chalk.cyan(replCmd("pax8 auth login"))} to re-authenticate.\n\n`)
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

  // Flush telemetry before exit (#145) so failure events actually reach
  // PostHog. Bounded by a 2s timeout in flushAndShutdown.
  await flushTelemetryBeforeExit();
  process.exit(1);

  // If process.exit was overridden (e.g. REPL mode), throw to stop execution.
  // This ensures the `never` return type contract is honored.
  throw new Error("process.exit intercepted");
}
