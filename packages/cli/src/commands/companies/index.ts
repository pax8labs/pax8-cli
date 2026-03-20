import { Command } from "commander";
import { companiesListCommand } from "./list.js";
import { companiesShowCommand } from "./show.js";
import { companiesCreateCommand } from "./create.js";
import { companiesUpdateCommand } from "./update.js";

export function registerCompaniesCommands(program: Command): void {
  const companies = new Command("companies").description("Manage companies");

  companies.addCommand(companiesListCommand);
  companies.addCommand(companiesShowCommand);
  companies.addCommand(companiesCreateCommand);
  companies.addCommand(companiesUpdateCommand);

  program.addCommand(companies);
}
