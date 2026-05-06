// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { replCmd } from "../../lib/confirm.js";
import { formatDate } from "../../lib/formatters.js";

function parseSinceMs(input: string): number {
  // Accepts e.g. 7d, 24h, 30m. Returns milliseconds to subtract from now.
  const match = input.match(/^(\d+)([dhm])$/);
  if (!match) {
    throw new CliError(
      `Invalid --since value: "${input}"`,
      ['Use format like "7d", "24h", or "30m"'],
      ['Example: pax8 webhooks logs --since 7d'],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const ms =
    unit === "d" ? n * 86_400_000 : unit === "h" ? n * 3_600_000 : n * 60_000;
  return ms;
}

export const webhooksLogsCommand = new Command("logs")
  .description("View webhook delivery history")
  .argument("[id]", "Webhook ID (omit to show logs across all webhooks)")
  .option("--since <duration>", 'Only show logs within window (e.g. "7d", "24h")')
  .option("--ids-only", "Output only log IDs, one per line")
  .option("--with-actions", "Wrap JSON output as { logs, nextActions } instead of a flat array")
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks logs
  pax8 webhooks logs 11111111-2222-3333-4444-555555555501
  pax8 webhooks logs 11111111-2222-3333-4444-555555555501 --since 7d
  pax8 webhooks logs --json`,
  )
  .action(async (id: string | undefined, options, command: Command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching webhook logs...");

    try {
      spinner.start();

      let allLogs: Awaited<ReturnType<typeof ctx.api.webhooks.getLogs>> = [];

      if (id) {
        allLogs = await ctx.api.webhooks.getLogs(id);
      } else {
        // No id provided — fan out to every configured webhook.
        const webhooks = await ctx.api.webhooks.list();
        for (const wh of webhooks) {
          const logs = await ctx.api.webhooks.getLogs(wh.id).catch(() => []);
          allLogs.push(...logs);
        }
      }

      // Newest first
      allLogs.sort(
        (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
      );

      if (options.since) {
        const cutoff = Date.now() - parseSinceMs(options.since);
        allLogs = allLogs.filter((l) => new Date(l.sentAt).getTime() >= cutoff);
      }

      spinner.stop();

      if (globalOpts.idsOnly) {
        for (const log of allLogs) {
          process.stdout.write(log.id + "\n");
        }
        return;
      }

      if (ctx.outputFormat === "json") {
        if (options.withActions) {
          const nextActions: { command: string; description: string }[] = [];
          const failures = allLogs.filter(
            (l) => l.responseCode === 0 || l.responseCode >= 400,
          );
          if (failures.length > 0 && id) {
            nextActions.push({
              command: `pax8 webhooks test ${id}`,
              description: `Re-test the endpoint — ${failures.length} recent failure${failures.length === 1 ? "" : "s"}`,
            });
          }
          process.stdout.write(
            JSON.stringify({ logs: allLogs, nextActions }, null, 2) + "\n",
          );
        } else {
          process.stdout.write(JSON.stringify(allLogs, null, 2) + "\n");
        }
        return;
      }

      const columns = [
        {
          key: "id",
          header: "Log ID",
          width: 12,
          format: (v: unknown) => String(v).slice(0, 8),
        },
        {
          key: "webhookId",
          header: "Webhook",
          width: 12,
          format: (v: unknown) => String(v).slice(0, 8),
        },
        { key: "topic", header: "Topic", width: 26 },
        {
          key: "responseCode",
          header: "Code",
          width: 8,
          format: (v: unknown) => {
            const code = Number(v);
            if (code === 0) return chalk.red("timeout");
            if (code >= 200 && code < 300) return chalk.green(String(code));
            if (code >= 400) return chalk.red(String(code));
            return String(code);
          },
        },
        {
          key: "sentAt",
          header: "Sent",
          width: 18,
          format: (v: unknown) => formatDate(String(v)),
        },
      ];

      output(allLogs as unknown as Record<string, unknown>[], {
        format: ctx.outputFormat,
        columns,
      });

      if (ctx.outputFormat === "table") {
        const failures = allLogs.filter(
          (l) => l.responseCode === 0 || l.responseCode >= 400,
        );
        process.stderr.write(
          chalk.dim(
            `\n  ${allLogs.length} log${allLogs.length === 1 ? "" : "s"}` +
              (failures.length > 0 ? ` · ${failures.length} failure${failures.length === 1 ? "" : "s"}` : "") +
              "\n",
          ),
        );
        if (id) {
          process.stderr.write(chalk.dim("\n  Try next:\n"));
          process.stderr.write(
            `    ${chalk.cyan(replCmd(`pax8 webhooks test ${id}`))}  ${chalk.dim("send a fresh test delivery")}\n`,
          );
          process.stderr.write("\n");
        }
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to fetch webhook logs");
    }
  });
