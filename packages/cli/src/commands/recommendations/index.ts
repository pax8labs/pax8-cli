import { Command } from "commander";
import { recommendationsListCommand } from "./list.js";
import { recommendationsActCommand } from "./act.js";

export function registerRecommendationsCommands(program: Command): void {
  const recommendations = new Command("recommendations")
    .description("Product recommendations based on customer portfolio analysis")
    .alias("recs");

  recommendations.addCommand(recommendationsListCommand);
  recommendations.addCommand(recommendationsActCommand);

  program.addCommand(recommendations);
}
