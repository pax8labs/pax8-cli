// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT, ERROR_NOT_FOUND } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { confirm, replCmd } from "../../lib/confirm.js";
import { formatDate } from "../../lib/formatters.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";

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

// ─── List action (default behavior) ──────────────────────────────────────────
//
// Extracted to a reusable function so the `webhooks logs` parent command can
// dispatch to it as its default action (preserving backward-compat for
// `pax8 webhooks logs [id]` invocations) AND so the explicit `webhooks logs
// list [id]` subcommand can call the same code path.

interface LogsListOptions {
  since?: string;
  withActions?: boolean;
}

async function runLogsList(
  id: string | undefined,
  options: LogsListOptions,
  command: Command,
): Promise<void> {
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

    // Tier 0 credential redaction (#300): defensively strip any `secret`
    // field that might appear in a log entry. WebhookLogSchema does not
    // declare one, but trust nothing — redact at the read path.
    allLogs = allLogs.map((entry) => {
      const e = entry as unknown as Record<string, unknown>;
      if ("secret" in e) {
        const { secret: _redactedSecret, ...rest } = e;
        void _redactedSecret;
        return rest as unknown as (typeof allLogs)[number];
      }
      return entry;
    });

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
        if (failures.length > 0) {
          const firstFailure = failures[0];
          nextActions.push({
            command: `pax8 webhooks logs retry ${firstFailure.id}`,
            description: `Retry the most recent failed delivery (${failures.length} failure${failures.length === 1 ? "" : "s"} in window)`,
          });
        }
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

    output(allLogs, {
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
      if (failures.length > 0) {
        const firstFailure = failures[0];
        process.stderr.write(chalk.dim("\n  Try next:\n"));
        process.stderr.write(
          `    ${chalk.cyan(replCmd(`pax8 webhooks logs retry ${firstFailure.id}`))}  ${chalk.dim("re-deliver the failed event")}\n`,
        );
        if (id) {
          process.stderr.write(
            `    ${chalk.cyan(replCmd(`pax8 webhooks test ${id}`))}  ${chalk.dim("send a fresh test delivery")}\n`,
          );
        }
        process.stderr.write("\n");
      } else if (id) {
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
}

// ─── Subcommand: webhooks logs list ──────────────────────────────────────────

const logsListSubcommand = new Command("list")
  .description("List webhook delivery history (default action)")
  .argument("[id]", "Webhook ID (omit to show logs across all webhooks)")
  .option("--since <duration>", 'Only show logs within window (e.g. "7d", "24h")')
  .option("--ids-only", "Output only log IDs, one per line")
  .option(
    "--with-actions",
    "Wrap JSON output as { logs, nextActions } instead of a flat array",
  )
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks logs list
  pax8 webhooks logs list 11111111-2222-3333-4444-555555555501
  pax8 webhooks logs list 11111111-2222-3333-4444-555555555501 --since 7d
  pax8 webhooks logs list --json`,
  )
  .action(runLogsList);

// ─── Subcommand: webhooks logs retry ─────────────────────────────────────────

const logsRetrySubcommand = new Command("retry")
  .description("Re-deliver a failed webhook event")
  .argument("<log-id>", "Log ID to retry (from `pax8 webhooks logs`)")
  .option(
    "--webhook <id>",
    "Webhook ID owning the log. Required only when the log isn't reachable via the cross-webhook listing.",
  )
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks logs retry 22222222-3333-4444-5555-666666666604
  pax8 webhooks logs retry 22222222-3333-4444-5555-666666666604 --yes
  pax8 webhooks logs retry 22222222-3333-4444-5555-666666666604 --webhook 11111111-2222-3333-4444-555555555503 --json`,
  )
  .action(async (logId: string, options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    try {
      const ctx = await buildContext(allOpts);

      // The retry endpoint is `POST /webhooks/{webhookId}/logs/{logId}/retry`,
      // so we need both ids. If the user passed --webhook explicitly we trust
      // it; otherwise we resolve by walking each webhook's log index.
      let webhookId: string | undefined =
        typeof options.webhook === "string" ? options.webhook : undefined;
      let originalLog: { topic: string; responseCode: number; sentAt: string } | undefined;

      if (!webhookId) {
        const lookupSpinner = createSpinner("Locating delivery...").start();
        try {
          const webhooks = await ctx.api.webhooks.list();
          for (const wh of webhooks) {
            const logs = await ctx.api.webhooks
              .getLogs(wh.id)
              .catch(() => [] as Awaited<ReturnType<typeof ctx.api.webhooks.getLogs>>);
            const found = logs.find((l) => l.id === logId);
            if (found) {
              webhookId = wh.id;
              originalLog = {
                topic: found.topic,
                responseCode: found.responseCode,
                sentAt: found.sentAt,
              };
              break;
            }
          }
        } finally {
          lookupSpinner.stop();
        }
      }

      if (!webhookId) {
        throw new CliError(
          `Could not find a webhook for log "${logId}".`,
          [
            "The log id didn't match any delivery in the configured webhook list.",
          ],
          [
            `Pass the owning webhook explicitly: ${replCmd("pax8 webhooks logs retry")} ${logId} --webhook <webhook-id>`,
            `List recent deliveries: ${replCmd("pax8 webhooks logs")}`,
          ],
          undefined,
          ERROR_NOT_FOUND,
        );
      }

      // Show what will happen
      process.stderr.write(chalk.bold("\n  Re-deliver webhook event:\n\n"));
      process.stderr.write(`  ${chalk.dim("Log:".padEnd(12))}${logId}\n`);
      process.stderr.write(`  ${chalk.dim("Webhook:".padEnd(12))}${webhookId}\n`);
      if (originalLog) {
        process.stderr.write(
          `  ${chalk.dim("Topic:".padEnd(12))}${originalLog.topic}\n`,
        );
        process.stderr.write(
          `  ${chalk.dim("Original:".padEnd(12))}${originalLog.responseCode === 0 ? "timeout" : originalLog.responseCode} · ${formatDate(originalLog.sentAt)}\n`,
        );
      }
      process.stderr.write("\n");
      process.stderr.write(
        chalk.yellow(
          "  ⚠ This will re-send the original event payload to the webhook URL.\n\n",
        ),
      );

      const confirmed = await confirm("Retry this delivery?", { default: true });
      if (!confirmed) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Retrying delivery...").start();
      const doneRetry = markWriteInFlight("webhooks");
      let result: Record<string, unknown> | unknown;
      try {
        result = await ctx.api.webhooks.retryLog(webhookId, logId);
      } finally {
        doneRetry();
      }
      await invalidateCacheAfterWrite();
      spinner.succeed("Retry submitted");

      const responseCode =
        result && typeof result === "object" && "responseCode" in result
          ? Number((result as { responseCode: unknown }).responseCode)
          : undefined;

      if (ctx.outputFormat === "json") {
        const nextActions = [
          {
            command: `pax8 webhooks logs ${webhookId}`,
            description: "View delivery history including this retry",
          },
        ];
        process.stdout.write(
          JSON.stringify(
            { logId, webhookId, retried: true, result, nextActions },
            null,
            2,
          ) + "\n",
        );
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("Log:".padEnd(14))}${logId}\n`);
      process.stdout.write(`  ${chalk.dim("Webhook:".padEnd(14))}${webhookId}\n`);
      if (responseCode !== undefined) {
        const codeText =
          responseCode === 0
            ? chalk.red("timeout")
            : responseCode >= 200 && responseCode < 300
              ? chalk.green(String(responseCode))
              : chalk.red(String(responseCode));
        process.stdout.write(`  ${chalk.dim("Response:".padEnd(14))}${codeText}\n`);
      }
      process.stdout.write("\n");

      process.stderr.write(chalk.dim("  Try next:\n"));
      process.stderr.write(
        `    ${chalk.cyan(replCmd(`pax8 webhooks logs ${webhookId}`))}  ${chalk.dim("view delivery history")}\n`,
      );
      process.stderr.write("\n");
    } catch (error) {
      await handleCommandError(
        error,
        undefined,
        "Failed to retry webhook delivery",
      );
    }
  });

// ─── Parent: webhooks logs ───────────────────────────────────────────────────
//
// We wire the parent command's own `.action(...)` to the same `runLogsList`
// handler used by the explicit `list` subcommand. With Commander, when no
// subcommand name matches the next argv token, the parent's action runs —
// so `pax8 webhooks logs <id>`, `pax8 webhooks logs --since 7d`, and
// `pax8 webhooks logs --json` all keep working exactly as they did before
// the conversion.

export const webhooksLogsCommand = new Command("logs")
  .description("View and manage webhook delivery history")
  .argument("[id]", "Webhook ID (omit to show logs across all webhooks)")
  .option("--since <duration>", 'Only show logs within window (e.g. "7d", "24h")')
  .option("--ids-only", "Output only log IDs, one per line")
  .option(
    "--with-actions",
    "Wrap JSON output as { logs, nextActions } instead of a flat array",
  )
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks logs
  pax8 webhooks logs 11111111-2222-3333-4444-555555555501
  pax8 webhooks logs 11111111-2222-3333-4444-555555555501 --since 7d
  pax8 webhooks logs --json
  pax8 webhooks logs retry 22222222-3333-4444-5555-666666666604`,
  )
  .action(runLogsList);

webhooksLogsCommand.addCommand(logsListSubcommand);
webhooksLogsCommand.addCommand(logsRetrySubcommand);
