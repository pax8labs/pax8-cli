// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { confirm, replCmd } from "../../lib/confirm.js";
import { markWriteInFlight } from "../../lib/signals.js";

export const webhooksTestCommand = new Command("test")
  .description("Trigger a test delivery for a webhook subscription")
  .argument("<id>", "Webhook ID")
  .option(
    "--topic <topic>",
    "Send a topic-specific test (e.g. invoice.paid). Defaults to a generic webhook-level test.",
  )
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks test 11111111-2222-3333-4444-555555555501
  pax8 webhooks test 11111111-2222-3333-4444-555555555501 --topic subscription.created
  pax8 webhooks test 11111111-2222-3333-4444-555555555501 --yes
  pax8 webhooks test 11111111-2222-3333-4444-555555555501 --json

Note: this triggers a REAL HTTP delivery from Pax8 to the URL registered
on the webhook subscription. That endpoint is typically partner-controlled
(PSA, ticketing system, automation). Always preview the URL before
confirming.`,
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

      // #464 — `pax8 webhooks test` triggers a REAL HTTP POST from Pax8 to
      // the partner-registered webhook URL (typically the partner's PSA,
      // ticketing, or automation system). The CLI safety contract classifies
      // this as a write — show what URL is about to be hit, then prompt
      // unless `--yes` / `PAX8_YES=1`. Skip the preview/prompt in JSON mode
      // so agents driving the CLI get the same flag-gated behavior they
      // expect from `orders create` / `invoices dispute`.
      const previewSpinner = createSpinner("Fetching webhook details...").start();
      let webhookUrl = "<url unknown>";
      let registeredTopics: string[] = [];
      try {
        const hook = (await ctx.api.webhooks.get(id)) as {
          url?: string;
          topics?: string[];
        };
        if (typeof hook.url === "string") webhookUrl = hook.url;
        if (Array.isArray(hook.topics)) registeredTopics = hook.topics;
      } finally {
        previewSpinner.stop();
      }

      // Emit the preview block to stderr (metadata, not data) in every mode
      // except quiet — agents driving the CLI under `--json` also benefit
      // from seeing which URL the test is about to hit before approving.
      if (ctx.outputFormat !== "quiet") {
        process.stderr.write("\n");
        process.stderr.write(`  ${chalk.dim("Webhook:".padEnd(14))}${id}\n`);
        process.stderr.write(`  ${chalk.dim("Target URL:".padEnd(14))}${webhookUrl}\n`);
        if (topic) {
          process.stderr.write(`  ${chalk.dim("Topic:".padEnd(14))}${topic}\n`);
        } else if (registeredTopics.length > 0) {
          process.stderr.write(
            `  ${chalk.dim("Topics:".padEnd(14))}${registeredTopics.join(", ")}\n`,
          );
        }
        process.stderr.write("\n");
      }

      const ok = await confirm(`Send test delivery to ${webhookUrl}?`, { default: true });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner(
        topic ? `Sending test delivery for ${topic}...` : "Sending test delivery...",
      ).start();
      const doneWrite = markWriteInFlight("webhooks", id);
      let result: Record<string, unknown>;
      try {
        result = topic
          ? ((await ctx.api.webhooks.testTopic(id, topic)) as Record<string, unknown>)
          : ((await ctx.api.webhooks.test(id)) as Record<string, unknown>);
      } finally {
        doneWrite();
      }
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
