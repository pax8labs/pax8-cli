// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatStatus, formatDate } from "../../lib/formatters.js";
import { replCmd } from "../../lib/confirm.js";

export const webhooksShowCommand = new Command("show")
  .description("Show details for a single webhook subscription")
  .argument("<id>", "Webhook ID")
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks show 11111111-2222-3333-4444-555555555501
  pax8 webhooks show 11111111-2222-3333-4444-555555555501 --json`,
  )
  .action(async (id: string, _options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const spinner = createSpinner("Fetching webhook...");

    try {
      const ctx = await buildContext(allOpts);
      spinner.start();
      const webhook = await ctx.api.webhooks.get(id);
      spinner.stop();

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(webhook, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      // Detail view: human-readable, padded label column on stderr would
      // hide it from pipes — but `show` is detail-on-stdout (matches
      // companies show / contacts show).
      process.stdout.write("\n");
      process.stdout.write(
        chalk.bold(`  ${webhook.displayName ?? "Webhook"}\n\n`),
      );
      process.stdout.write(`  ${chalk.dim("ID:".padEnd(20))}${webhook.id}\n`);
      process.stdout.write(
        `  ${chalk.dim("Status:".padEnd(20))}${formatStatus(webhook.status)}\n`,
      );
      process.stdout.write(`  ${chalk.dim("URL:".padEnd(20))}${webhook.url}\n`);
      if (webhook.displayName) {
        process.stdout.write(
          `  ${chalk.dim("Display Name:".padEnd(20))}${webhook.displayName}\n`,
        );
      }
      if (webhook.contactEmail) {
        process.stdout.write(
          `  ${chalk.dim("Contact Email:".padEnd(20))}${webhook.contactEmail}\n`,
        );
      }
      if (webhook.errorThreshold !== undefined) {
        process.stdout.write(
          `  ${chalk.dim("Error Threshold:".padEnd(20))}${webhook.errorThreshold}\n`,
        );
      }
      process.stdout.write(
        `  ${chalk.dim("Topics:".padEnd(20))}${webhook.topics.length === 0 ? chalk.dim("—") : webhook.topics.join(", ")}\n`,
      );
      if (webhook.lastDeliveryStatus) {
        process.stdout.write(
          `  ${chalk.dim("Last Delivery:".padEnd(20))}${webhook.lastDeliveryStatus}\n`,
        );
      }
      process.stdout.write(
        `  ${chalk.dim("Created:".padEnd(20))}${formatDate(webhook.createdDate)}\n`,
      );
      if (webhook.updatedAt) {
        process.stdout.write(
          `  ${chalk.dim("Updated:".padEnd(20))}${formatDate(webhook.updatedAt)}\n`,
        );
      }
      process.stdout.write("\n");

      if (ctx.outputFormat === "table") {
        process.stderr.write(chalk.dim("  Try next:\n"));
        process.stderr.write(
          `    ${chalk.cyan(replCmd(`pax8 webhooks logs ${webhook.id}`))}  ${chalk.dim("view delivery history")}\n`,
        );
        process.stderr.write(
          `    ${chalk.cyan(replCmd(`pax8 webhooks test ${webhook.id}`))}  ${chalk.dim("send a test delivery")}\n`,
        );
        process.stderr.write("\n");
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to show webhook");
    }
  });
