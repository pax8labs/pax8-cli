import {
  getTelemetry,
  AuthError,
  RateLimitError,
  ValidationError,
  ApiError,
  ERROR_AUTH_EXPIRED,
  ERROR_RATE_LIMITED,
  ERROR_API_VALIDATION,
  ERROR_API_TIMEOUT,
  ERROR_NOT_FOUND,
  ERROR_INTERNAL,
  type Pax8ErrorCode,
} from "@pax8/core";
import { CliError } from "./errors.js";

/**
 * Map an arbitrary thrown value to a canonical `Pax8ErrorCode`. The README's
 * Telemetry table promises `error_code` is one of the `ERROR_*` constants from
 * `@pax8/core`; this is the function that keeps that promise.
 *
 * If the error is already a `CliError` carrying a code, prefer that — it's
 * the authoritative value set at the throw site.
 */
export function classifyError(error: unknown): Pax8ErrorCode {
  if (error instanceof CliError && error.code) return error.code;
  if (error instanceof AuthError) return ERROR_AUTH_EXPIRED;
  if (error instanceof RateLimitError) return ERROR_RATE_LIMITED;
  if (error instanceof ValidationError) return ERROR_API_VALIDATION;
  if (error instanceof ApiError) {
    if (error.statusCode === 408) return ERROR_API_TIMEOUT;
    if (error.statusCode === 401 || error.statusCode === 403) {
      return ERROR_AUTH_EXPIRED;
    }
    if (error.statusCode === 404) return ERROR_NOT_FOUND;
    if (error.statusCode === 429) return ERROR_RATE_LIMITED;
    return ERROR_INTERNAL;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("etimedout") ||
      msg.includes("fetch failed") ||
      msg.includes("network")
    ) {
      return ERROR_API_TIMEOUT;
    }
  }
  return ERROR_INTERNAL;
}

function extractFlagNames(options: Record<string, unknown>): string[] {
  const flags: string[] = [];
  for (const key of Object.keys(options)) {
    if (options[key] !== undefined && options[key] !== false) {
      // Convert camelCase to --kebab-case
      const flag = "--" + key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      flags.push(flag);
    }
  }
  return flags.sort();
}

export function instrumentedAction(
  commandName: string,
  action: (options: Record<string, unknown>) => Promise<void>,
): (options: Record<string, unknown>) => Promise<void> {
  return async (options: Record<string, unknown>) => {
    const start = Date.now();
    const telemetry = getTelemetry();

    try {
      await action(options);

      telemetry.track({
        event: "command_executed",
        command: commandName,
        flags: extractFlagNames(options ?? {}),
        duration_ms: Date.now() - start,
        success: true,
        cli_version: "0.1.0",
        node_version: process.version,
        os: process.platform,
        demo_mode: process.env.PAX8_DEMO === "1",
      });
    } catch (error) {
      telemetry.track({
        event: "command_executed",
        command: commandName,
        flags: extractFlagNames(options ?? {}),
        duration_ms: Date.now() - start,
        success: false,
        error_code: classifyError(error),
        cli_version: "0.1.0",
        node_version: process.version,
        os: process.platform,
        demo_mode: process.env.PAX8_DEMO === "1",
      });

      throw error; // Re-throw so normal error handling still works
    } finally {
      // Fire-and-forget — never block the CLI on telemetry
      telemetry.flush().then(() => telemetry.shutdown()).catch(() => {});
    }
  };
}
