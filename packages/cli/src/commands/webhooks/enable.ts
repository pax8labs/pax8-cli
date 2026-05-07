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

export const webhooksEnableCommand = new Command("enable")
  .description("Enable a webhook subscription so Pax8 resumes deliveries")
  .argument("<id>", "Webhook ID")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks enable 11111111-2222-3333-4444-555555555503
  pax8 webhooks enable 11111111-2222-3333-4444-555555555503 --yes
  pax8 webhooks enable 11111111-2222-3333-4444-555555555503 --json`,
  )
  .action(async (id: string, _options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    try {
      const ctx = await buildContext(allOpts);

      const fetchSpinner = createSpinner("Fetching webhook...").start();
      const current = await ctx.api.webhooks.get(id);
      fetchSpinner.stop();

      // Idempotent short-circuit — flipping an already-Active webhook is a
      // no-op against the API too, but callers (including agents looping
      // over a list) appreciate a deterministic "no change needed" path.
      if (current.status === "Active") {
        if (ctx.outputFormat === "json") {
          process.stdout.write(
            JSON.stringify({ ...current, alreadyEnabled: true }, null, 2) + "\n",
          );
          return;
        }
        if (ctx.outputFormat === "quiet") return;
        process.stderr.write(
          chalk.dim(`\n  Webhook ${current.id} is already Active. No change made.\n\n`),
        );
        return;
      }

      process.stderr.write(chalk.bold("\n  Enable Webhook:\n\n"));
      process.stderr.write(`  ${chalk.dim("ID:".padEnd(14))}${current.id}\n`);
      process.stderr.write(`  ${chalk.dim("URL:".padEnd(14))}${current.url}\n`);
      process.stderr.write(
        `  ${chalk.dim("Status:".padEnd(14))}${chalk.gray(current.status)} ${chalk.dim("→")} ${chalk.green("Active")}\n\n`,
      );

      const ok = await confirm("Enable this webhook?", { default: true });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Enabling webhook...").start();
      const done = markWriteInFlight("webhooks");
      let updated;
      try {
        updated = await ctx.api.webhooks.setStatus(id, true);
      } finally {
        done();
      }
      await invalidateCacheAfterWrite();
      spinner.succeed("Webhook enabled");

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(updated, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("ID:".padEnd(14))}${updated.id}\n`);
      process.stdout.write(
        `  ${chalk.dim("Status:".padEnd(14))}${chalk.green(updated.status)}\n`,
      );
      process.stdout.write("\n");

      process.stderr.write(chalk.dim("  Try next:\n"));
      process.stderr.write(
        `    ${chalk.cyan(replCmd(`pax8 webhooks test ${updated.id}`))}  ${chalk.dim("send a test delivery")}\n`,
      );
      process.stderr.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to enable webhook");
    }
  });
