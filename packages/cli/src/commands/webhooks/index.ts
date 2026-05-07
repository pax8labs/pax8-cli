// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { webhooksListCommand } from "./list.js";
import { webhooksShowCommand } from "./show.js";
import { webhooksCreateCommand } from "./create.js";
import { webhooksUpdateCommand } from "./update.js";
import { webhooksEnableCommand } from "./enable.js";
import { webhooksDisableCommand } from "./disable.js";
import { webhooksDeleteCommand } from "./delete.js";
import { webhooksTestCommand } from "./test.js";
import { webhooksLogsCommand } from "./logs.js";
import { webhooksTopicsCommand } from "./topics/index.js";

export function registerWebhooksCommands(program: Command): void {
  const webhooks = new Command("webhooks").description(
    "Manage webhook subscriptions for Pax8 events",
  );

  webhooks.addCommand(webhooksListCommand);
  webhooks.addCommand(webhooksShowCommand);
  webhooks.addCommand(webhooksCreateCommand);
  webhooks.addCommand(webhooksUpdateCommand);
  webhooks.addCommand(webhooksEnableCommand);
  webhooks.addCommand(webhooksDisableCommand);
  webhooks.addCommand(webhooksDeleteCommand);
  webhooks.addCommand(webhooksTestCommand);
  webhooks.addCommand(webhooksLogsCommand);
  webhooks.addCommand(webhooksTopicsCommand);

  program.addCommand(webhooks);
}
