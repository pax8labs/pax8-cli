// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import type { UpdateWebhookConfigurationInput } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { confirm, replCmd } from "../../lib/confirm.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Redact a sensitive header value so we never echo a bearer token in plain text.
 * Returns first 4 + last 4 chars separated by an ellipsis; fully masks
 * anything ≤ 8 chars.
 */
export function redactAuthorization(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export const webhooksUpdateCommand = new Command("update")
  .description("Update mutable configuration on a webhook subscription")
  .argument("<id>", "Webhook ID")
  .option("--display-name <text>", "Human-friendly label for the webhook")
  .option(
    "--authorization <header-value>",
    "Authorization header sent on each delivery (treated as sensitive)",
  )
  .option(
    "--contact-email <email>",
    "Email Pax8 notifies when delivery failures exceed the threshold",
  )
  .option(
    "--error-threshold <number>",
    "Consecutive failures before notifying contactEmail (1-20)",
  )
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks update 11111111-2222-3333-4444-555555555501 --display-name "Subs prod"
  pax8 webhooks update 11111111-2222-3333-4444-555555555501 --error-threshold 5 --yes
  pax8 webhooks update 11111111-2222-3333-4444-555555555501 --authorization "Bearer abc123..." --json`,
  )
  .action(async (id: string, _options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    try {
      const ctx = await buildContext(allOpts);

      const data: UpdateWebhookConfigurationInput = {};

      if (allOpts.displayName !== undefined) {
        const v = String(allOpts.displayName).trim();
        if (v.length === 0) {
          throw new CliError(
            "Invalid --display-name",
            ["--display-name must not be empty"],
            [`Try: ${replCmd("pax8 webhooks update")} ${id} --display-name "My webhook"`],
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
        data.displayName = v;
      }

      if (allOpts.authorization !== undefined) {
        data.authorization = String(allOpts.authorization);
      }

      if (allOpts.contactEmail !== undefined) {
        const email = String(allOpts.contactEmail).trim();
        if (!EMAIL_RE.test(email)) {
          throw new CliError(
            `Invalid --contact-email: "${allOpts.contactEmail}"`,
            ["Value must look like an email address (user@domain.tld)"],
            [
              `Try: ${replCmd("pax8 webhooks update")} ${id} --contact-email ops@example.com`,
            ],
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
        data.contactEmail = email;
      }

      if (allOpts.errorThreshold !== undefined) {
        const raw = String(allOpts.errorThreshold);
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || String(n) !== raw.trim() || n < 1 || n > 20) {
          throw new CliError(
            `Invalid --error-threshold: "${allOpts.errorThreshold}"`,
            ["Must be an integer between 1 and 20"],
            [
              `Try: ${replCmd("pax8 webhooks update")} ${id} --error-threshold 5`,
            ],
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
        data.errorThreshold = n;
      }

      if (Object.keys(data).length === 0) {
        throw new CliError(
          "No fields to update",
          [
            "At least one of --display-name, --authorization, --contact-email, or --error-threshold is required",
          ],
          [
            `Try: ${replCmd("pax8 webhooks update")} ${id} --display-name "My webhook"`,
            `See: ${replCmd("pax8 webhooks update --help")}`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      // Look up the current webhook so we can show the user what they're
      // changing and emit a clean error if the id doesn't exist.
      const fetchSpinner = createSpinner("Fetching webhook...").start();
      const current = await ctx.api.webhooks.get(id);
      fetchSpinner.stop();

      // Diff preview — redact `authorization` so we never echo a bearer token
      // in plain text. JSON consumers see the raw payload via the response.
      process.stderr.write(chalk.bold("\n  Update Webhook:\n\n"));
      process.stderr.write(`  ${chalk.dim("ID:".padEnd(18))}${current.id}\n`);
      process.stderr.write(
        `  ${chalk.dim("URL:".padEnd(18))}${current.url}\n\n`,
      );
      for (const [k, v] of Object.entries(data)) {
        const label =
          k === "displayName"
            ? "Display Name"
            : k === "contactEmail"
              ? "Contact Email"
              : k === "errorThreshold"
                ? "Error Threshold"
                : k === "authorization"
                  ? "Authorization"
                  : k;
        const display =
          k === "authorization"
            ? redactAuthorization(String(v))
            : String(v);
        process.stderr.write(
          `  ${chalk.dim((label + ":").padEnd(18))}${chalk.green(display)}\n`,
        );
      }
      process.stderr.write("\n");

      const ok = await confirm("Apply these changes?", { default: true });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Updating webhook...").start();
      const doneUpdate = markWriteInFlight("webhooks");
      let updated;
      try {
        updated = await ctx.api.webhooks.updateConfiguration(id, data);
      } finally {
        doneUpdate();
      }
      await invalidateCacheAfterWrite();
      spinner.succeed("Webhook updated");

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(updated, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("ID:".padEnd(18))}${updated.id}\n`);
      process.stdout.write(`  ${chalk.dim("URL:".padEnd(18))}${updated.url}\n`);
      if (updated.displayName) {
        process.stdout.write(
          `  ${chalk.dim("Display Name:".padEnd(18))}${updated.displayName}\n`,
        );
      }
      if (updated.contactEmail) {
        process.stdout.write(
          `  ${chalk.dim("Contact Email:".padEnd(18))}${updated.contactEmail}\n`,
        );
      }
      if (updated.errorThreshold !== undefined) {
        process.stdout.write(
          `  ${chalk.dim("Error Threshold:".padEnd(18))}${updated.errorThreshold}\n`,
        );
      }
      process.stdout.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to update webhook");
    }
  });
