import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatStatus, formatDate } from "../../lib/formatters.js";
import { replCmd } from "../../lib/confirm.js";

export const webhooksListCommand = new Command("list")
  .description("List configured webhook subscriptions")
  .option("--ids-only", "Output only webhook IDs, one per line")
  .option("--with-actions", "Wrap JSON output as { webhooks, nextActions } instead of a flat array")
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks list
  pax8 webhooks list --json
  pax8 webhooks list --ids-only
  pax8 webhooks list --ids-only | xargs -I{} pax8 webhooks logs {}`,
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching webhooks...");

    try {
      spinner.start();
      const webhooks = await ctx.api.webhooks.list();
      spinner.stop();

      if (globalOpts.idsOnly) {
        for (const wh of webhooks) {
          process.stdout.write(wh.id + "\n");
        }
        return;
      }

      if (ctx.outputFormat === "json") {
        if (options.withActions) {
          const nextActions: { command: string; description: string }[] = [];
          if (webhooks.length === 0) {
            nextActions.push({
              command: "pax8 webhooks create --url <url> --events <comma-separated-events>",
              description: "Create your first webhook subscription",
            });
          } else {
            const first = webhooks[0];
            nextActions.push({
              command: `pax8 webhooks test ${first.id}`,
              description: "Send a test delivery to verify the endpoint",
            });
            nextActions.push({
              command: `pax8 webhooks logs ${first.id}`,
              description: "View recent delivery history",
            });
          }
          process.stdout.write(
            JSON.stringify({ webhooks, nextActions }, null, 2) + "\n",
          );
        } else {
          process.stdout.write(JSON.stringify(webhooks, null, 2) + "\n");
        }
        return;
      }

      const columns = [
        { key: "id", header: "ID", width: 12, format: (v: unknown) => String(v).slice(0, 8) },
        { key: "url", header: "URL", width: 42 },
        {
          key: "status",
          header: "Status",
          width: 12,
          format: (v: unknown) => formatStatus(String(v)),
        },
        {
          key: "topics",
          header: "Topics",
          width: 24,
          format: (v: unknown) => {
            const arr = Array.isArray(v) ? (v as string[]) : [];
            if (arr.length === 0) return "—";
            if (arr.length <= 2) return arr.join(", ");
            return `${arr.slice(0, 2).join(", ")} +${arr.length - 2}`;
          },
        },
        {
          key: "createdDate",
          header: "Created",
          width: 14,
          format: (v: unknown) => formatDate(String(v)),
        },
      ];

      output(webhooks as unknown as Record<string, unknown>[], {
        format: ctx.outputFormat,
        columns,
      });

      if (ctx.outputFormat === "table") {
        process.stderr.write(
          chalk.dim(`\n  ${webhooks.length} webhook${webhooks.length === 1 ? "" : "s"}\n`),
        );
        if (webhooks.length === 0) {
          process.stderr.write(chalk.dim("\n  Try next:\n"));
          process.stderr.write(
            `    ${chalk.cyan(replCmd("pax8 webhooks create --url <url> --events <events>"))}  ${chalk.dim("create your first subscription")}\n`,
          );
        } else {
          const first = webhooks[0];
          process.stderr.write(chalk.dim("\n  Try next:\n"));
          process.stderr.write(
            `    ${chalk.cyan(replCmd(`pax8 webhooks test ${first.id}`))}  ${chalk.dim("send a test delivery")}\n`,
          );
          process.stderr.write(
            `    ${chalk.cyan(replCmd(`pax8 webhooks logs ${first.id}`))}  ${chalk.dim("view delivery history")}\n`,
          );
        }
        process.stderr.write("\n");
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to list webhooks");
    }
  });
