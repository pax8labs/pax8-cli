import { Command } from "commander";

export function registerCompaniesCommands(program: Command): void {
  program.addCommand(
    new Command("companies").description("Manage companies")
  );
}
