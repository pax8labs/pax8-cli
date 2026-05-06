// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { invoicesListCommand } from "./list.js";
import { invoicesShowCommand } from "./show.js";
import { invoicesItemsCommand } from "./items.js";
import { invoicesAuditCommand } from "./audit.js";
import { invoicesDisputeCommand } from "./dispute.js";

export function registerInvoicesCommands(program: Command): void {
  const invoices = new Command("invoices").description("Manage invoices");

  invoices.addCommand(invoicesListCommand);
  invoices.addCommand(invoicesShowCommand);
  invoices.addCommand(invoicesItemsCommand);
  invoices.addCommand(invoicesAuditCommand);
  invoices.addCommand(invoicesDisputeCommand);

  program.addCommand(invoices);
}
