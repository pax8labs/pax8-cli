// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { reportRenewalsCommand } from "./renewals.js";
import { reportConcentrationCommand } from "./concentration.js";
import { reportSubscriptionsCommand } from "./subscriptions.js";

// `pax8 report *` is the honest Pax8-cost reporting surface. After #440
// removed `report mrr` / `report growth` (those were partner-revenue framed
// against Pax8-cost data), the three commands below fill the gap:
//
//   renewals       — what's ending soon, and how much Pax8 cost it represents
//   concentration  — where my Pax8 spend is concentrated (customer/vendor/product)
//   subscriptions  — what I'm currently paying Pax8 for, grouped
//
// Every subcommand emits AmountCurrency envelopes for currency-bearing fields
// (post-#440 convention) and carries the standardized disclaimer footer on
// --help. None of them claim to compute partner-side MRR / revenue.
export function registerReportCommands(program: Command): void {
  const report = new Command("report")
    .description("Pax8-cost reporting — renewals, concentration, and subscription rollups")
    .addHelpText(
      "after",
      `
Subcommands:
  renewals       Subscriptions with upcoming commitment-term-end dates
  concentration  Where your Pax8 spend is concentrated (client/vendor/product)
  subscriptions  Active subscriptions grouped by client, vendor, product, or billing term

Examples:
  pax8 report renewals --within 90
  pax8 report concentration --by client --top 5
  pax8 report subscriptions --by billing-term --json

Note: Numbers shown are Pax8 cost — what Pax8 charges you. For partner revenue (what you charge your customers), combine with sell-through pricing from your PSA.`,
    );

  report.addCommand(reportRenewalsCommand);
  report.addCommand(reportConcentrationCommand);
  report.addCommand(reportSubscriptionsCommand);

  program.addCommand(report);
}
