import { Command } from "commander";
import { webhooksListCommand } from "./list.js";
import { webhooksCreateCommand } from "./create.js";
import { webhooksDeleteCommand } from "./delete.js";
import { webhooksTestCommand } from "./test.js";
import { webhooksLogsCommand } from "./logs.js";

export function registerWebhooksCommands(program: Command): void {
  const webhooks = new Command("webhooks").description(
    "Manage webhook subscriptions for Pax8 events",
  );

  webhooks.addCommand(webhooksListCommand);
  webhooks.addCommand(webhooksCreateCommand);
  webhooks.addCommand(webhooksDeleteCommand);
  webhooks.addCommand(webhooksTestCommand);
  webhooks.addCommand(webhooksLogsCommand);

  program.addCommand(webhooks);
}
