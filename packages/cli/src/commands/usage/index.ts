import { Command } from "commander";
import { usageListCommand } from "./list.js";
import { usageShowCommand } from "./show.js";

export function registerUsageCommands(program: Command): void {
  const usage = new Command("usage").description("View metered usage summaries (Azure consumption, etc.)");

  usage.addCommand(usageListCommand);
  usage.addCommand(usageShowCommand);

  program.addCommand(usage);
}
