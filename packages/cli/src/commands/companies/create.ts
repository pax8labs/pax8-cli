import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { confirm } from "../../lib/confirm.js";

export const companiesCreateCommand = new Command("create")
  .description("Create a new company")
  .requiredOption("--name <name>", "Company name (required)")
  .option("--phone <phone>", "Company phone number")
  .option("--website <url>", "Company website")
  .option("--city <city>", "City")
  .option("--state <state>", "State or province")
  .option("--zip <zip>", "Postal code")
  .option("--country <country>", "Country code (e.g. US)", "US")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 companies create --name "Acme Corp" --phone "+1-555-0100" --website "https://acme.com"
  pax8 companies create --name "Test Co" --city Denver --state CO --zip 80202 --country US
  pax8 companies create --name "Quick Co" --yes`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    try {
      const ctx = await buildContext(allOpts);

      // Show what will be created
      process.stderr.write(chalk.bold("\n  Creating company:\n\n"));
      process.stderr.write(`  ${chalk.dim("Name:")}     ${allOpts.name}\n`);
      if (allOpts.phone) process.stderr.write(`  ${chalk.dim("Phone:")}    ${allOpts.phone}\n`);
      if (allOpts.website) process.stderr.write(`  ${chalk.dim("Website:")}  ${allOpts.website}\n`);
      if (allOpts.city || allOpts.state || allOpts.zip) {
        const addrParts = [allOpts.city, allOpts.state, allOpts.zip].filter(Boolean);
        process.stderr.write(`  ${chalk.dim("Location:")} ${addrParts.join(", ")} ${allOpts.country}\n`);
      }
      process.stderr.write("\n");

      const confirmed = await confirm("Create this company?", { default: true });
      if (!confirmed) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Creating company...").start();

      const company = await ctx.api.companies.create({
        name: allOpts.name,
        phone: allOpts.phone || "",
        website: allOpts.website || "",
        address: {
          street: "",
          city: allOpts.city || "",
          stateOrProvince: allOpts.state || "",
          postalCode: allOpts.zip || "",
          country: allOpts.country || "US",
        },
      });

      spinner.succeed("Company created");

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(company, null, 2) + "\n");
        return;
      }

      process.stdout.write("\n");
      process.stdout.write(chalk.bold(`  ${company.name}\n\n`));
      process.stdout.write(`  ${chalk.dim("ID:")}       ${company.id}\n`);
      process.stdout.write(`  ${chalk.dim("Status:")}   ${company.status}\n`);
      process.stdout.write("\n");
    } catch (error) {
      handleCommandError(error, undefined, "Failed to create company");
    }
  });
