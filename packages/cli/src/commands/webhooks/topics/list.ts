// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../../lib/context.js";
import { output } from "../../../lib/output.js";
import { createSpinner } from "../../../lib/spinner.js";
import { handleCommandError } from "../../../lib/errors.js";
import { replCmd } from "../../../lib/confirm.js";

export const webhooksTopicsListCommand = new Command("list")
  .description("List webhook topic definitions available for subscription")
  .option("--ids-only", "Output only topic slugs, one per line")
  .option(
    "--with-actions",
    "Wrap JSON output as { topics, nextActions } instead of a flat array",
  )
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks topics list
  pax8 webhooks topics list --json
  pax8 webhooks topics list --ids-only
  pax8 webhooks topics list --ids-only | xargs -I{} echo "topic: {}"`,
  )
  .action(async (options, command: Command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching topic definitions...");

    try {
      spinner.start();
      const topics = await ctx.api.webhooks.getTopicDefinitions();
      spinner.stop();

      // Sort alphabetically by slug for stable, agent-friendly output.
      const sorted = [...topics].sort((a, b) =>
        a.topic.localeCompare(b.topic),
      );

      if (globalOpts.idsOnly) {
        for (const t of sorted) {
          process.stdout.write(t.topic + "\n");
        }
        return;
      }

      if (ctx.outputFormat === "json") {
        if (options.withActions) {
          const nextActions: { command: string; description: string }[] = [];
          if (sorted.length > 0) {
            nextActions.push({
              command:
                "pax8 webhooks create --url https://example.com/hook --events " +
                sorted[0].topic,
              description: "Create a webhook subscribed to this topic",
            });
          }
          process.stdout.write(
            JSON.stringify({ topics: sorted, nextActions }, null, 2) + "\n",
          );
        } else {
          process.stdout.write(JSON.stringify(sorted, null, 2) + "\n");
        }
        return;
      }

      const columns = [
        { key: "topic", header: "Topic", width: 28 },
        { key: "description", header: "Description", width: 60 },
      ];

      output(sorted, {
        format: ctx.outputFormat,
        columns,
      });

      if (ctx.outputFormat === "table") {
        process.stderr.write(
          chalk.dim(
            `\n  ${sorted.length} topic${sorted.length === 1 ? "" : "s"}\n`,
          ),
        );
        if (sorted.length > 0) {
          process.stderr.write(chalk.dim("\n  Try next:\n"));
          process.stderr.write(
            `    ${chalk.cyan(replCmd(`pax8 webhooks create --url https://example.com/hook --events ${sorted[0].topic}`))}  ${chalk.dim("subscribe to a topic")}\n`,
          );
          process.stderr.write("\n");
        }
      }
    } catch (error) {
      await handleCommandError(
        error,
        spinner,
        "Failed to fetch topic definitions",
      );
    }
  });
