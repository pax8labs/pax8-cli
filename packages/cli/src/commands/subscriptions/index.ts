// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { subscriptionsListCommand } from "./list.js";
import { subscriptionsShowCommand } from "./show.js";
import { subscriptionsUpdateCommand } from "./update.js";
import { subscriptionsCancelCommand } from "./cancel.js";
import { subscriptionsRenewalsCommand } from "./renewals.js";
import { subscriptionsExportCommand } from "./export.js";

export function registerSubscriptionsCommands(program: Command): void {
  const subs = new Command("subscriptions").description(
    "Manage subscriptions"
  );

  subs.addCommand(subscriptionsListCommand);
  subs.addCommand(subscriptionsShowCommand);
  subs.addCommand(subscriptionsUpdateCommand);
  subs.addCommand(subscriptionsCancelCommand);
  subs.addCommand(subscriptionsRenewalsCommand);
  subs.addCommand(subscriptionsExportCommand);

  program.addCommand(subs);
}
