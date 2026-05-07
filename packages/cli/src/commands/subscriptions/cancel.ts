// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { CliError, handleCommandError } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/confirm.js";
import { formatCurrency, formatQuantity, calculateMrr } from "../../lib/formatters.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { replCmd } from "../../lib/confirm.js";
import { markWriteInFlight } from "../../lib/signals.js";

/**
 * Validate a `YYYY-MM-DD` cancel date. Returns the normalized string on
 * success, throws a `CliError(ERROR_INVALID_INPUT)` with recovery hints on
 * failure. We accept the simple ISO calendar form only — the Pax8 API treats
 * `cancelDate` as a date (not a timestamp), and accepting timestamps would
 * silently drop the time portion.
 */
function parseCancelDate(raw: string): string {
  const trimmed = raw.trim();
  // Strict YYYY-MM-DD shape so "2026-1-1" and "1/15/2026" don't sneak through.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new CliError(
      `Invalid --cancel-date "${raw}".`,
      ["Expected ISO calendar form YYYY-MM-DD (e.g. 2026-12-31)."],
      [
        `Pass the date as YYYY-MM-DD: ${chalk.cyan(replCmd("pax8 subscriptions cancel <id> --cancel-date 2026-12-31"))}`,
        "Omit --cancel-date for an immediate cancellation.",
      ],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  // Reject calendar-impossible values (Feb 30, month 13, etc.) — the regex
  // above is a shape check, this is the round-trip semantic check.
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  const reserialized = Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
  if (reserialized !== trimmed) {
    throw new CliError(
      `Invalid --cancel-date "${raw}".`,
      ["The value parses as a calendar-impossible date."],
      [
        `Pass a real calendar date as YYYY-MM-DD: ${chalk.cyan(replCmd("pax8 subscriptions cancel <id> --cancel-date 2026-12-31"))}`,
      ],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  return trimmed;
}

export const subscriptionsCancelCommand = new Command("cancel")
  .description("Cancel a subscription")
  .argument("<id>", "Subscription ID")
  .option("--cancel-date <YYYY-MM-DD>", "Schedule cancellation for a future date (ISO YYYY-MM-DD)")
  .option("-y, --yes", "Skip confirmation prompts")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions cancel sub-summit-m365bp-001
  pax8 subscriptions cancel sub-summit-m365bp-001 --yes
  pax8 subscriptions cancel sub-summit-m365bp-001 --cancel-date 2026-12-31`
  )
  .action(async (id, options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);

    try {
      const cancelDate = allOpts.cancelDate
        ? parseCancelDate(String(allOpts.cancelDate))
        : undefined;

      // Fetch subscription details to show what will be cancelled
      const spinner = createSpinner("Fetching subscription...").start();
      const sub = await ctx.api.subscriptions.get(id);
      spinner.stop();

      // Calculate estimated MRR impact
      const mrr = calculateMrr(sub.price ?? 0, sub.quantity, String(sub.billingTerm ?? "Monthly"));

      if (ctx.outputFormat === "table") {
        // Table format only: humans see the preview block.
        // In --json/--csv/--quiet, stdout is reserved for the data envelope.
        const heading = cancelDate
          ? `\n  Subscription to be cancelled on ${cancelDate}:\n\n`
          : "\n  Subscription to be cancelled:\n\n";
        process.stdout.write(chalk.red.bold(heading));
        process.stdout.write(`  ${chalk.bold("Company")}      ${sub.companyName ?? sub.companyId}\n`);
        process.stdout.write(`  ${chalk.bold("Product")}      ${sub.productName}\n`);
        process.stdout.write(`  ${chalk.bold("Quantity")}     ${formatQuantity(sub.quantity)}\n`);
        if (cancelDate) {
          process.stdout.write(`  ${chalk.bold("Cancel Date")}  ${cancelDate}\n`);
        }
        process.stdout.write(`  ${chalk.bold("Est. MRR Impact")}   ${chalk.red("-" + formatCurrency(mrr))}\n`);
        process.stdout.write("\n");
      }

      // Destructive confirmation — surface the scheduled date so the user
      // doesn't conflate scheduled with immediate cancellation.
      const confirmed = await confirmDestructive(
        cancelDate
          ? `This will schedule cancellation for ${cancelDate}. This action cannot be undone.`
          : "This action cannot be undone.",
        "cancel"
      );

      if (!confirmed) {
        process.stderr.write(chalk.yellow("\n  Cancellation aborted.\n\n"));
        return;
      }

      const cancelSpinner = createSpinner(
        cancelDate ? `Scheduling cancellation for ${cancelDate}...` : "Cancelling subscription...",
      ).start();
      const doneCancel = markWriteInFlight("subscriptions");
      try {
        await ctx.api.subscriptions.delete(id, cancelDate ? { cancelDate } : undefined);
      } finally {
        doneCancel();
      }
      await invalidateCacheAfterWrite();
      cancelSpinner.succeed(
        cancelDate ? `Cancellation scheduled for ${cancelDate}` : "Subscription cancelled",
      );

      if (ctx.outputFormat === "json") {
        output(
          [
            cancelDate
              ? { id: sub.id, status: "Cancelled", cancelDate }
              : { id: sub.id, status: "Cancelled" },
          ],
          { format: "json" },
        );
      }

      // Next steps
      process.stderr.write(chalk.dim("\n  Try next:\n"));
      const coName = sub.companyName ?? sub.companyId;
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 subscriptions list --company "${coName}"`))}  ${chalk.dim("remaining subscriptions")}\n`);
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 orders create --company "${coName}" --product <name>`))}  ${chalk.dim("order a replacement")}\n`);
      process.stderr.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to cancel subscription");
    }
  });
