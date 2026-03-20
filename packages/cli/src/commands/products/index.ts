import { Command } from "commander";

export function registerProductsCommands(program: Command): void {
  program.addCommand(
    new Command("products").description("Manage products")
  );
}
