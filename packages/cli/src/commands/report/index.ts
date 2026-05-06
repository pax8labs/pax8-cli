// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { reportMrrCommand } from "./mrr.js";
import { reportGrowthCommand } from "./growth.js";

export function registerReportCommands(program: Command): void {
  const report = new Command("report").description(
    "Estimated MRR (subscriptions) and growth (invoices) reporting"
  );

  report.addCommand(reportMrrCommand);
  report.addCommand(reportGrowthCommand);

  program.addCommand(report);
}
