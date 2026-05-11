// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";
import { ZodError, ZodIssueCode } from "zod";
import type { Ora } from "ora";
import * as fs from "node:fs";
import * as path from "node:path";
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
  Pax8SecurityError,
  getConfigDir,
  getTelemetry,
  isApiTimeoutError,
  safeWriteFileSync,
  type Pax8ErrorCode,
} from "@pax8/core";
import { replCmd } from "./confirm.js";
import { redactEnvelope } from "./redactor.js";

declare const __CLI_VERSION__: string;

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
/**
 * Generic recovery steps for an `ERROR_API_TIMEOUT`. Commands that know their
 * timeout has a domain-specific workaround (e.g. `orders list` with `--size`
 * and `--company` filters) prepend their hint and then concatenate these as
 * the floor — so the env-var escape hatch is always offered.
 *
 * Cap at 5 minutes is documented in `client.ts` (`MAX_TIMEOUT_MS`); we omit
 * it from the user-facing copy to keep the hint short — the env var is the
 * load-bearing detail.
 */
export function timeoutRecoverySteps(extra?: string[]): string[] {
  const generic = [
    "Retry the command — transient slowness on the Pax8 API is common.",
    "Extend the per-request timeout with PAX8_TIMEOUT_MS=60000 (or higher; capped at 300000).",
    "Run pax8 doctor to check connectivity to the Pax8 API.",
  ];
  return extra ? [...extra, ...generic] : generic;
}

function codeForApiError(error: ApiError): Pax8ErrorCode {
  const status = error.statusCode;
  // #199: the AbortController path in `Pax8Client.request` throws an `ApiError`
  // with `statusCode === 0` and a "Request timed out after Nms" message.
  // Treat that as the same agent-observable error class as a 408 — partners
  // and agents should see one canonical `ERROR_API_TIMEOUT` regardless of
  // whether the timeout originated at the client side or upstream.
  if (isApiTimeoutError(error)) return ERROR_API_TIMEOUT;
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
 * Persist a richer copy of the error envelope to `~/.pax8/last-error.json`
 * (mode 0600) so `pax8 report-bug` has something to report. Includes
 * command/flag *names* (no values) and runtime metadata. Failures here are
 * intentionally swallowed — we never want a config-dir issue (read-only fs,
 * full disk, sandboxed env) to hide the actual error from the user.
 */
function getCliVersion(): string {
  return typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0";
}

/**
 * Best-effort extraction of the command name (e.g. "companies list"), the
 * flag *names* (e.g. ["--json", "--page"]), and the positional argument
 * *values* from `process.argv`.
 *
 * The returned `command` field renders positional arguments as
 * `<REDACTED:ARG>` placeholders rather than their literal values, so that
 * what we persist to disk preserves the structure of the invocation
 * (`companies show <REDACTED:ARG>`) without leaking the user-supplied
 * customer / company / product name. See #170 — the public README's
 * Telemetry section commits to never sending names, but this field used to
 * pass them through.
 *
 * `argTokens` (the raw values) is returned **only** for the redactor's
 * post-pass to strip these same values from the message / causes /
 * recoverySteps fields where commands may have interpolated them
 * (`Company not found: "${input}"`). It is never written to disk.
 *
 * Subcommand detection: we treat the leading run of tokens that look like
 * Commander subcommand names (`/^[a-z][\w-]*$/i`, capped at 3 levels) as
 * the command path. Any non-flag token after that boundary is a positional
 * arg. Flags are collected from anywhere in argv, not only before the
 * first positional, fixing a pre-existing bug where
 * `pax8 companies show "Acme" --json` lost the `--json` flag.
 */
function extractCommandAndFlags(): {
  command: string;
  flags: string[];
  argTokens: string[];
} {
  const args = process.argv.slice(2);
  const cmdParts: string[] = [];
  const flags: string[] = [];
  const argTokens: string[] = [];
  let inSubcommandPrefix = true;
  for (const a of args) {
    if (a.startsWith("--")) {
      // Strip "--flag=value" form down to "--flag".
      const eq = a.indexOf("=");
      flags.push(eq >= 0 ? a.slice(0, eq) : a);
    } else if (a.startsWith("-")) {
      flags.push(a);
    } else if (
      inSubcommandPrefix &&
      cmdParts.length < 2 &&
      /^[a-z][\w-]*$/i.test(a)
    ) {
      // Still consuming the leading subcommand path. Cap at 2 levels — the
      // CLI's deepest command tree today is `<group> <action>` (e.g.
      // `companies show`, `recommendations act`). Leaving this generous (the
      // pre-#170 code allowed up to 3) would mistake a positional like
      // `pax8 companies show definitely-does-not-exist` for a subcommand
      // and skip redacting it. If a future subcommand goes 3 deep, raise
      // this cap intentionally.
      cmdParts.push(a);
    } else {
      // Once we see a non-subcommand-shaped token, every subsequent non-flag
      // token is a positional argument value. Capture it for the redactor
      // post-pass; render a placeholder in the command string.
      inSubcommandPrefix = false;
      argTokens.push(a);
    }
  }
  const placeholders = argTokens.map(() => "<REDACTED:ARG>");
  const commandRendered = [...cmdParts, ...placeholders].join(" ") || "unknown";
  return {
    command: commandRendered,
    flags: [...new Set(flags)].sort(),
    argTokens,
  };
}

function writeLastErrorEnvelope(envelope: ErrorEnvelope): void {
  try {
    const dir = getConfigDir();
    fs.mkdirSync(dir, { recursive: true });
    const { command, flags, argTokens } = extractCommandAndFlags();
    // Decision (#170): redact at envelope-write time, not at report-bug-print
    // time. The file on disk should already be sanitized — both because a
    // future tool that reads ~/.pax8/last-error.json (e.g. an upload helper)
    // should see redacted content, and because it shrinks the surface area
    // for redactor-bypass bugs. The acceptable trade-off is that a developer
    // debugging their own error locally gets less context here; they have
    // the original failure on stderr already.
    const redacted = redactEnvelope(
      {
        ...envelope,
        command,
        flags,
      },
      argTokens,
    );
    const payload = {
      ...redacted,
      cli_version: getCliVersion(),
      node_version: process.version,
      os: process.platform,
      timestamp: new Date().toISOString(),
    };
    const filePath = path.join(dir, "last-error.json");
    // #262: safeWriteFileSync opens with O_CREAT | O_EXCL-equivalent flags
    // and refuses to follow an existing symlink at the destination. It
    // also sets 0o600 atomically at creation time, so the previous
    // `writeFile then chmod` race window is gone.
    safeWriteFileSync(filePath, JSON.stringify(payload, null, 2));
  } catch {
    // Persisting the envelope is a nice-to-have for `pax8 report-bug`. Never
    // let it interfere with the user-facing error path.
  }
}

/**
 * Build the JSON envelope for a thrown error. Omits fields that aren't set so
 * consumers don't have to special-case `null`.
 */
function buildErrorEnvelope(error: unknown, context?: string): ErrorEnvelope {
  const prefix = context ? `${context}: ` : "";

  if (error instanceof CliError || error instanceof Pax8SecurityError) {
    // Pax8SecurityError lives in core (it's thrown from core call sites
    // like getDefaultBaseUrl / getConfigDir, before any cli code runs) but
    // is structurally the same as CliError — same fields, same intent.
    // Render it through the same path so the user sees identical output
    // regardless of which package raised the failure.
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
    if (env.code === ERROR_API_TIMEOUT) {
      // #199: the generic timeout-recovery hint. Per-command paths (e.g.
      // `orders list`) wrap their catch with a more specific CliError before
      // reaching here; this is the floor every other timeout falls back to.
      env.recoverySteps = timeoutRecoverySteps();
    } else if (error.statusCode === 401 || error.statusCode === 403) {
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

  // Persist the structured envelope so `pax8 report-bug` has something to
  // report. Write happens *before* any exit logic. This is decoupled from the
  // telemetry pipeline by design (works with telemetry off).
  // Coordination: another agent is rewriting handleCommandError to be async
  // and to flush before exit (#145/#146). This call is logically independent —
  // resolve any rebase by keeping both the envelope-write and the flush.
  const envelope = buildErrorEnvelope(error, context);
  writeLastErrorEnvelope(envelope);

  // Machine-readable JSON envelope when --json is set
  if (isJsonOutputRequested()) {
    process.stderr.write(JSON.stringify(envelope, null, 2) + "\n");
    // Flush telemetry before exit (#145) so failure events actually reach
    // PostHog. Bounded by a 2s timeout in flushAndShutdown.
    await flushTelemetryBeforeExit();
    process.exit(1);

    // Honor never return contract when process.exit is mocked
    throw new Error("process.exit intercepted");
  }

  const prefix = context ? `${context}\n` : "";

  if (error instanceof CliError || error instanceof Pax8SecurityError) {
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

    if (error.code) {
      process.stderr.write(
        chalk.dim(
          `\n  → Help us fix this: run ${chalk.cyan(replCmd("pax8 report-bug"))} to file a sanitized report\n`
        )
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
    if (isApiTimeoutError(error)) {
      // #199: surface the same recovery steps the JSON envelope carries.
      // Use the generic floor here; per-command paths upgrade this by
      // catching the timeout themselves and re-throwing a `CliError`
      // (which renders through the branch above with their richer hint).
      for (const step of timeoutRecoverySteps()) {
        process.stderr.write(
          chalk.yellow(`    → ${step}\n`)
        );
      }
      process.stderr.write("\n");
    } else if (error.statusCode === 401 || error.statusCode === 403) {
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
