// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import prompts, { type PromptObject } from "prompts";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import { CliError } from "./errors.js";

/**
 * Wrap prompts() with a uniform SIGINT-on-cancel path. Any prompt cancelled
 * via Ctrl+C exits with code 130 cleanly without a stack trace, matching
 * the rest of the CLI's signal contract (see lib/signals.ts).
 *
 * Returns the answer object (typed as Record<string, unknown> by prompts).
 * Callers extract the fields they care about.
 */
export async function ask(
  questions: PromptObject | PromptObject[],
): Promise<Record<string, unknown>> {
  return prompts(questions, {
    onCancel: () => {
      process.stderr.write("\n");
      process.exit(130);
    },
  });
}

/**
 * Throw `ERROR_INVALID_INPUT` if stdin is not a TTY and no `--yes` bypass
 * was provided. Use before calling ask() in commands that require
 * interactive input.
 */
export function requireTTY(commandHint: string): void {
  if (!process.stdin.isTTY) {
    throw new CliError(
      `Cannot show interactive picker — stdin is not a TTY`,
      [`${commandHint} needs a terminal for interactive prompts`],
      [
        `Pass --yes to bypass interactive prompts`,
        `Or pipe input appropriately for non-interactive use`,
      ],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
}
