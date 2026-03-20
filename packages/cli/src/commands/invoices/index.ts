import { Command } from "commander";

export function registerInvoicesCommands(program: Command): void {
  program.addCommand(
    new Command("invoices").description("Manage invoices")
  );
}
