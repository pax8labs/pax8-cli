import { Command } from "commander";

export function registerSubscriptionsCommands(program: Command): void {
  program.addCommand(
    new Command("subscriptions").description("Manage subscriptions")
  );
}
