import { Command } from "commander";

export function registerOrdersCommands(program: Command): void {
  program.addCommand(
    new Command("orders").description("Manage orders")
  );
}
