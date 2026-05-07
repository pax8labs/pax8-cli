// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { quotesLineItemsListCommand } from "./list.js";
import { quotesLineItemsAddCommand } from "./add.js";
import { quotesLineItemsRemoveCommand } from "./remove.js";

export function buildQuotesLineItemsCommand(): Command {
  const lineItems = new Command("line-items").description(
    "Manage line items on a quote (list / add / remove)",
  );
  lineItems.addCommand(quotesLineItemsListCommand);
  lineItems.addCommand(quotesLineItemsAddCommand);
  lineItems.addCommand(quotesLineItemsRemoveCommand);
  return lineItems;
}
