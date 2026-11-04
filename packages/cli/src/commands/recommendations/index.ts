// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { recommendationsListCommand } from "./list.js";
import { recommendationsActCommand } from "./act.js";
import { recommendationsUpsellCommand } from "./upsell.js";
import { recommendationsWhyCommand } from "./why.js";
import { recommendationsEmailCommand } from "./email.js";

export function registerRecommendationsCommands(program: Command): void {
  const recommendations = new Command("recommendations")
    .description("Product recommendations based on customer portfolio analysis")
    .alias("recs");

  recommendations.addCommand(recommendationsListCommand);
  recommendations.addCommand(recommendationsActCommand);
  recommendations.addCommand(recommendationsUpsellCommand);
  recommendations.addCommand(recommendationsWhyCommand);
  recommendations.addCommand(recommendationsEmailCommand);

  program.addCommand(recommendations);
}
