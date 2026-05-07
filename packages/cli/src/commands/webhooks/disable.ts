// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { confirm, replCmd } from "../../lib/confirm.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";

export const webhooksDisableCommand = new Command("disable")
  .description("Disable a webhook subscription so Pax8 stops sending deliveries")
  .argument("<id>", "Webhook ID")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks disable 11111111-2222-3333-4444-555555555501
  pax8 webhooks disable 11111111-2222-3333-4444-555555555501 --yes
  pax8 webhooks disable 11111111-2222-3333-4444-555555555501 --json`,
  )
  .action(async (id: string, _options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    try {
      const ctx = await buildContext(allOpts);

      const fetchSpinner = createSpinner("Fetching webhook...").start();
      const current = await ctx.api.webhooks.get(id);
      fetchSpinner.stop();

      // Idempotent short-circuit — already disabled is a no-op.
      if (current.status === "Disabled") {
        if (ctx.outputFormat === "json") {
          process.stdout.write(
            JSON.stringify({ ...current, alreadyDisabled: true }, null, 2) + "\n",
          );
          return;
        }
        if (ctx.outputFormat === "quiet") return;
        process.stderr.write(
          chalk.dim(`\n  Webhook ${current.id} is already Disabled. No change made.\n\n`),
        );
        return;
      }

      process.stderr.write(chalk.bold("\n  Disable Webhook:\n\n"));
      process.stderr.write(`  ${chalk.dim("ID:".padEnd(14))}${current.id}\n`);
      process.stderr.write(`  ${chalk.dim("URL:".padEnd(14))}${current.url}\n`);
      process.stderr.write(
        `  ${chalk.dim("Status:".padEnd(14))}${chalk.green(current.status)} ${chalk.dim("→")} ${chalk.gray("Disabled")}\n\n`,
      );
      process.stderr.write(
        chalk.yellow("  ⚠ Pax8 will stop delivering events to this URL until re-enabled.\n\n"),
      );

      const ok = await confirm("Disable this webhook?", { default: false });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Disabling webhook...").start();
      const done = markWriteInFlight("webhooks");
      let updated;
      try {
        updated = await ctx.api.webhooks.setStatus(id, false);
      } finally {
        done();
      }
      await invalidateCacheAfterWrite();
      spinner.succeed("Webhook disabled");

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(updated, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("ID:".padEnd(14))}${updated.id}\n`);
      process.stdout.write(
        `  ${chalk.dim("Status:".padEnd(14))}${chalk.gray(updated.status)}\n`,
      );
      process.stdout.write("\n");

      process.stderr.write(chalk.dim("  Try next:\n"));
      process.stderr.write(
        `    ${chalk.cyan(replCmd(`pax8 webhooks enable ${updated.id}`))}  ${chalk.dim("re-enable when ready")}\n`,
      );
      process.stderr.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to disable webhook");
    }
  });
