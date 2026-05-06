import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { confirm } from "../../lib/confirm.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { resolveCompany } from "../../lib/resolve-company.js";
import { markWriteInFlight } from "../../lib/signals.js";

export const companiesUpdateCommand = new Command("update")
  .description("Update a company")
  .argument("<id|name>", "Company ID or name")
  .option("--name <name>", "New company name")
  .option("--phone <phone>", "New phone number")
  .option("--website <url>", "New website URL")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 companies update a1b2c3d4-e5f6-7890-abcd-ef1234567890 --name "New Name"
  pax8 companies update a1b2c3d4-e5f6-7890-abcd-ef1234567890 --phone "+1-555-1234"
  pax8 companies update a1b2c3d4-e5f6-7890-abcd-ef1234567890 --name "Updated" --yes`
  )
  .action(async (idOrName: string, options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    try {
      const ctx = await buildContext(allOpts);

      const updates: Record<string, unknown> = {};
      if (allOpts.name) updates.name = allOpts.name;
      if (allOpts.phone) updates.phone = allOpts.phone;
      if (allOpts.website) updates.website = allOpts.website;

      if (Object.keys(updates).length === 0) {
        throw new CliError(
          "No updates provided",
          ["At least one update flag is required"],
          ["Use --name, --phone, or --website to specify what to update"],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      const resolved = await resolveCompany(ctx, idOrName);

      // Show what will be updated
      process.stderr.write(chalk.bold(`\n  Updating company ${resolved.name}:\n\n`));
      for (const [key, value] of Object.entries(updates)) {
        process.stderr.write(`  ${chalk.dim(key + ":")} ${value}\n`);
      }
      process.stderr.write("\n");

      const confirmed = await confirm("Apply these changes?", { default: true });
      if (!confirmed) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Updating company...").start();

      const doneUpdate = markWriteInFlight("companies");
      let company;
      try {
        company = await ctx.api.companies.update(resolved.id, updates);
      } finally {
        doneUpdate();
      }

      await invalidateCacheAfterWrite();
      spinner.succeed("Company updated");

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(company, null, 2) + "\n");
        return;
      }

      process.stdout.write("\n");
      process.stdout.write(chalk.bold(`  ${company.name}\n\n`));
      process.stdout.write(`  ${chalk.dim("ID:")}       ${company.id}\n`);
      process.stdout.write(`  ${chalk.dim("Status:")}   ${company.status}\n`);
      process.stdout.write(`  ${chalk.dim("Phone:")}    ${company.phone || chalk.dim("—")}\n`);
      process.stdout.write(`  ${chalk.dim("Website:")}  ${company.website || chalk.dim("—")}\n`);
      process.stdout.write("\n");
    } catch (error) {
      handleCommandError(error, undefined, "Failed to update company");
    }
  });
