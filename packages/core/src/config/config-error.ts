// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { ZodError } from "zod";

/**
 * The on-disk config failed schema validation (#729).
 *
 * Exists to keep a *local file* problem from being reported as a *remote*
 * one. `loadConfig()` used to let Zod's own error escape, and the CLI's
 * renderer treats a bare `ZodError` as "the Pax8 API returned an
 * unexpected response" — which is how a version-less `~/.pax8/config.yaml`
 * produced:
 *
 *     ✗ The Pax8 API returned an unexpected response.
 *       "version": expected 1.0, got undefined
 *
 * on a command that never made a request. Carrying the file path turns
 * that into something the reader can act on.
 */
export class ConfigValidationError extends Error {
  constructor(
    /** Absolute path of the offending file. */
    public readonly filePath: string,
    /** One `field: problem` string per Zod issue. */
    public readonly issues: string[],
    /** The underlying Zod error, for callers that want the detail. */
    public readonly cause?: ZodError,
  ) {
    super(`Config file at ${filePath} is not valid: ${issues.join("; ")}`);
    this.name = "ConfigValidationError";
  }
}

/** Render a ZodError's issues as `path: message` strings. */
export function describeConfigIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}
