import { Command } from "commander";
import { quotesListCommand } from "./list.js";
import { quotesShowCommand } from "./show.js";
import { quotesCreateCommand } from "./create.js";
import { quotesUpdateCommand } from "./update.js";
import { quotesDeleteCommand } from "./delete.js";

export function registerQuotesCommands(program: Command): void {
  const quotes = new Command("quotes").description("Manage sales quotes");

  quotes.addCommand(quotesListCommand);
  quotes.addCommand(quotesShowCommand);
  quotes.addCommand(quotesCreateCommand);
  quotes.addCommand(quotesUpdateCommand);
  quotes.addCommand(quotesDeleteCommand);

  program.addCommand(quotes);
}
