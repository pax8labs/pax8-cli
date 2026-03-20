import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { formatStatus, formatCompanyName } from "../../lib/formatters.js";

const columns: Column[] = [
  { key: "name", header: "Name", format: (v: string) => formatCompanyName(v, 30) },
  { key: "id", header: "ID" },
  { key: "status", header: "Status", format: (v: string) => formatStatus(v) },
];

export const companiesListCommand = new Command("list")
  .description("List all companies")
  .option("--page <number>", "Page number (zero-based)", "0")
  .option("--size <number>", "Page size", "10")
  .addHelpText(
    "after",
    `
Examples:
  pax8 companies list
  pax8 companies list --page 1 --size 25
  pax8 companies list --json
  pax8 companies list --csv`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const spinner = createSpinner("Loading companies...").start();

    try {
      const ctx = await buildContext(allOpts);
      const result = await ctx.api.companies.list({
        page: parseInt(allOpts.page, 10),
        size: parseInt(allOpts.size, 10),
      });

      spinner.stop();

      output(result.content, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        process.stderr.write(
          chalk.dim(`\n  ${result.page.totalElements} companies\n\n`)
        );
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to list companies");
    }
  });
