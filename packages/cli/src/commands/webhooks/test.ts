// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { replCmd } from "../../lib/confirm.js";

export const webhooksTestCommand = new Command("test")
  .description("Trigger a test delivery for a webhook subscription")
  .argument("<id>", "Webhook ID")
  .option(
    "--topic <topic>",
    "Send a topic-specific test (e.g. invoice.paid). Defaults to a generic webhook-level test.",
  )
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks test 11111111-2222-3333-4444-555555555501
  pax8 webhooks test 11111111-2222-3333-4444-555555555501 --topic subscription.created
  pax8 webhooks test 11111111-2222-3333-4444-555555555501 --json`,
  )
  .action(async (id: string, options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const topic =
      typeof options.topic === "string" && options.topic.length > 0
        ? options.topic
        : undefined;

    try {
      const ctx = await buildContext(allOpts);

      // If a topic is requested, validate it against the live topic-definition
      // catalog before issuing the test request. This trades one extra read
      // for a clean `ERROR_INVALID_INPUT` recovery path that points the user
      // at `pax8 webhooks topics list`, instead of letting the upstream API
      // return a less-actionable 4xx.
      if (topic) {
        const validateSpinner = createSpinner("Validating topic...").start();
        let known: { topic: string }[] = [];
        try {
          known = await ctx.api.webhooks.getTopicDefinitions();
        } finally {
          validateSpinner.stop();
        }
        const matched = known.some((t) => t.topic === topic);
        if (!matched) {
          throw new CliError(
            `Unknown webhook topic: "${topic}"`,
            [
              "The topic name didn't match any value returned by /webhooks/topic-definitions.",
            ],
            [
              `List available topics: ${replCmd("pax8 webhooks topics list")}`,
              `Example: ${replCmd("pax8 webhooks test")} ${id} --topic subscription.created`,
            ],
            "https://devx.pax8.com/openapi/webhooks-api.json",
            ERROR_INVALID_INPUT,
          );
        }
      }

      const spinner = createSpinner(
        topic ? `Sending test delivery for ${topic}...` : "Sending test delivery...",
      ).start();
      const result = topic
        ? ((await ctx.api.webhooks.testTopic(id, topic)) as Record<string, unknown>)
        : ((await ctx.api.webhooks.test(id)) as Record<string, unknown>);
      spinner.succeed("Test delivery sent");

      if (ctx.outputFormat === "json") {
        const nextActions = [
          {
            command: `pax8 webhooks logs ${id}`,
            description: "View delivery history including this test",
          },
        ];
        process.stdout.write(
          JSON.stringify(
            { id, topic, result, nextActions },
            null,
            2,
          ) + "\n",
        );
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("Webhook:".padEnd(14))}${id}\n`);
      if (topic) {
        process.stdout.write(`  ${chalk.dim("Topic:".padEnd(14))}${topic}\n`);
      }
      if (result && typeof result === "object") {
        for (const [key, value] of Object.entries(result)) {
          if (value === undefined || value === null) continue;
          // Avoid duplicating `topic` if the API echoes it back.
          if (topic && key === "topic") continue;
          const label = (key.charAt(0).toUpperCase() + key.slice(1) + ":").padEnd(14);
          process.stdout.write(`  ${chalk.dim(label)}${String(value)}\n`);
        }
      }
      process.stdout.write("\n");

      process.stderr.write(chalk.dim("  Try next:\n"));
      process.stderr.write(
        `    ${chalk.cyan(replCmd(`pax8 webhooks logs ${id}`))}  ${chalk.dim("view delivery history")}\n`,
      );
      process.stderr.write("\n");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to send test delivery");
    }
  });
