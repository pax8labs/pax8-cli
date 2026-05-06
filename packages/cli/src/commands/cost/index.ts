import { Command } from "commander";
import { costSimCommand } from "./sim.js";

export function registerCostCommands(program: Command): void {
  const cost = new Command("cost").description(
    "Cost simulations and what-if analysis (no writes)",
  );

  cost.addCommand(costSimCommand);

  program.addCommand(cost);
}
