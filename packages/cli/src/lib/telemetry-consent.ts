// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { createInterface } from "readline";
import chalk from "chalk";
import { getTelemetry } from "@pax8/core";
import { presenceEnv, truthyEnv } from "./update-check.js";

/**
 * One-time telemetry consent prompt, shown on the first interactive run.
 *
 * Telemetry stays OFF until the partner answers. Enter / "y" opts in; "n"
 * opts out; either answer is persisted (`telemetry.asked`) so the prompt
 * never repeats. Closing the prompt without an answer (EOF / Ctrl+D)
 * records nothing and asks again next time.
 *
 * Suppression, in order:
 *
 * Never prompt (always respected):
 *   - Already answered, already enabled, or an ambient opt-out
 *     (`PAX8_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`) — see needsConsent().
 *   - `pax8 telemetry ...` itself — the partner is already deciding.
 *   - `--json`, `--quiet`, `PAX8_QUIET=1` — machine-readable surface.
 *   - `--yes` / `-y` / `PAX8_YES=1` — scripted run; `--yes` auto-confirms
 *     writes, it must never be read as telemetry consent.
 *   - REPL children (`PAX8_REPL=1`) — the REPL owns stdin.
 *
 * Auto-suppressors (bypassed by `PAX8_TELEMETRY_PROMPT_TEST_FORCE=1`, the
 * seam subprocess tests use to drive the prompt over piped stdin):
 *   - `NODE_ENV=test`, `CI` — nobody is there to answer.
 *   - Non-TTY stdin or stderr — agents and pipelines.
 */
export function isConsentPromptSuppressed(commandName: string): boolean {
  if (commandName === "telemetry" || commandName.startsWith("telemetry.")) return true;
  if (process.argv.includes("--json")) return true;
  if (process.argv.includes("--quiet")) return true;
  if (truthyEnv("PAX8_QUIET")) return true;
  if (process.argv.includes("--yes") || process.argv.includes("-y")) return true;
  if (process.env.PAX8_YES === "1") return true;
  if (process.env.PAX8_REPL === "1") return true;

  if (truthyEnv("PAX8_TELEMETRY_PROMPT_TEST_FORCE")) return false;
  if (process.env.NODE_ENV === "test") return true;
  if (presenceEnv("CI")) return true;
  if (!process.stdin.isTTY || !process.stderr.isTTY) return true;
  return false;
}

const PROMPT_BODY = `
  ${chalk.bold("Help improve pax8?")}
  Share anonymous usage data: command names, success/failure, duration,
  OS and Node version. Never company names, IDs, credentials, or API data.
  Change anytime with ${chalk.cyan("pax8 telemetry disable")}.
`;

/** Resolves the trimmed answer, or `null` if stdin closed before one. */
function readAnswer(question: string): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    let answered = false;
    rl.on("close", () => {
      if (!answered) resolve(null);
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Show the consent prompt if it applies. Never throws — a consent hiccup
 * must not block the command the partner actually ran.
 */
export async function maybeAskTelemetryConsent(commandName: string): Promise<void> {
  try {
    if (isConsentPromptSuppressed(commandName)) return;
    const telemetry = getTelemetry();
    if (!(await telemetry.needsConsent())) return;

    process.stderr.write(PROMPT_BODY);
    const answer = await readAnswer(`  Share usage data? ${chalk.dim("[Y/n]")} `);
    if (answer === null) {
      process.stderr.write("\n");
      return;
    }

    const optIn = answer === "" || answer.toLowerCase().startsWith("y");
    await telemetry.recordConsent(optIn);
    process.stderr.write(
      optIn
        ? `  ${chalk.green("✓")} Thanks — telemetry enabled.\n\n`
        : `  ${chalk.green("✓")} No problem — telemetry stays off.\n\n`,
    );
  } catch {
    // Best-effort; fall through to the command.
  }
}
