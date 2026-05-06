// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { confirm, replCmd } from "../../lib/confirm.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";

function parseEvents(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isValidUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export const webhooksCreateCommand = new Command("create")
  .description("Create a webhook subscription")
  .requiredOption("--url <url>", "Webhook delivery URL (https recommended)")
  .requiredOption(
    "--events <comma-separated-events>",
    'Topics to subscribe to, comma-separated (e.g. "subscription.created,invoice.paid")',
  )
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks create --url https://example.com/hook --events subscription.created,subscription.cancelled
  pax8 webhooks create --url https://example.com/hook --events invoice.paid --yes`,
  )
  .action(async (_options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    try {
      const ctx = await buildContext(allOpts);

      const url = String(allOpts.url);
      const topics = parseEvents(String(allOpts.events));

      if (!isValidUrl(url)) {
        throw new CliError(
          `Invalid webhook URL: "${url}"`,
          ["URL must be an http:// or https:// URL"],
          [
            `Example: ${replCmd("pax8 webhooks create")} --url https://example.com/hook --events subscription.created`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      if (topics.length === 0) {
        throw new CliError(
          "At least one event topic is required",
          ["--events must contain one or more comma-separated topic names"],
          [
            `Example: ${replCmd("pax8 webhooks create")} --url ${url} --events subscription.created,invoice.paid`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      // Show what will be created
      process.stderr.write(chalk.bold("\n  Creating webhook subscription:\n\n"));
      process.stderr.write(`  ${chalk.dim("URL:".padEnd(10))}${url}\n`);
      process.stderr.write(`  ${chalk.dim("Events:".padEnd(10))}${topics.join(", ")}\n`);
      process.stderr.write("\n");

      const confirmed = await confirm("Create this webhook?", { default: true });
      if (!confirmed) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Creating webhook...").start();
      const doneCreate = markWriteInFlight("webhooks");
      let webhook;
      try {
        webhook = await ctx.api.webhooks.create({ url, topics });
      } finally {
        doneCreate();
      }
      await invalidateCacheAfterWrite();
      spinner.succeed("Webhook created");

      if (ctx.outputFormat === "json") {
        const nextActions = [
          {
            command: `pax8 webhooks test ${webhook.id}`,
            description: "Send a test delivery to verify the endpoint",
          },
          {
            command: `pax8 webhooks logs ${webhook.id}`,
            description: "View delivery history",
          },
        ];
        process.stdout.write(JSON.stringify({ ...webhook, nextActions }, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("ID:".padEnd(10))}${webhook.id}\n`);
      process.stdout.write(`  ${chalk.dim("URL:".padEnd(10))}${webhook.url}\n`);
      process.stdout.write(`  ${chalk.dim("Status:".padEnd(10))}${webhook.status}\n`);
      process.stdout.write(`  ${chalk.dim("Events:".padEnd(10))}${webhook.topics.join(", ")}\n`);
      if (webhook.secret) {
        process.stdout.write(`  ${chalk.dim("Secret:".padEnd(10))}${webhook.secret}\n`);
      }
      process.stdout.write("\n");

      process.stderr.write(chalk.dim("  Try next:\n"));
      process.stderr.write(
        `    ${chalk.cyan(replCmd(`pax8 webhooks test ${webhook.id}`))}  ${chalk.dim("send a test delivery")}\n`,
      );
      process.stderr.write(
        `    ${chalk.cyan(replCmd(`pax8 webhooks logs ${webhook.id}`))}  ${chalk.dim("view delivery history")}\n`,
      );
      process.stderr.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to create webhook");
    }
  });
