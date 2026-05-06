import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { replCmd } from "../../lib/confirm.js";

export const webhooksTestCommand = new Command("test")
  .description("Trigger a test delivery for a webhook subscription")
  .argument("<id>", "Webhook ID")
  .addHelpText(
    "after",
    `
Examples:
  pax8 webhooks test 11111111-2222-3333-4444-555555555501
  pax8 webhooks test 11111111-2222-3333-4444-555555555501 --json`,
  )
  .action(async (id: string, _options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    try {
      const ctx = await buildContext(allOpts);
      const spinner = createSpinner("Sending test delivery...").start();
      const result = (await ctx.api.webhooks.test(id)) as Record<string, unknown>;
      spinner.succeed("Test delivery sent");

      if (ctx.outputFormat === "json") {
        const nextActions = [
          {
            command: `pax8 webhooks logs ${id}`,
            description: "View delivery history including this test",
          },
        ];
        process.stdout.write(
          JSON.stringify({ id, result, nextActions }, null, 2) + "\n",
        );
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("Webhook:".padEnd(14))}${id}\n`);
      if (result && typeof result === "object") {
        for (const [key, value] of Object.entries(result)) {
          if (value === undefined || value === null) continue;
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
