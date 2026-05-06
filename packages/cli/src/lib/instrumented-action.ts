import {
  getTelemetry,
  AuthError,
  RateLimitError,
  ValidationError,
  ApiError,
} from "@pax8/core";

export function classifyError(error: unknown): string {
  if (error instanceof AuthError) return "AUTH_FAILED";
  if (error instanceof RateLimitError) return "RATE_LIMITED";
  if (error instanceof ValidationError) return "VALIDATION_ERROR";
  if (error instanceof ApiError) {
    if (error.statusCode === 404) return "NOT_FOUND";
    return "API_ERROR";
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
      return "NETWORK_ERROR";
    }
  }
  return "UNKNOWN";
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
