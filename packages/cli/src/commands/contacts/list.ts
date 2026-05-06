import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { resolveCompany } from "../../lib/resolve-company.js";
import { replCmd } from "../../lib/confirm.js";

export const contactsListCommand = new Command("list")
  .description("List contacts for a company")
  .option("--company <id|name>", "Company ID or name (required)")
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", "Page size", "50")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 contacts list --company "Summit Healthcare Partners"
  pax8 contacts list --company a1b2c3d4-e5f6-7890-abcd-ef1234567890
  pax8 contacts list --company "Summit Healthcare Partners" --json
  pax8 contacts list --company "Summit Healthcare Partners" --csv
  pax8 contacts list --company "Summit Healthcare Partners" --ids-only | xargs -I{} pax8 contacts show {}`
  )
  .action(async (options, command) => {
    const allOpts = command.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching contacts...");

    try {
      if (!allOpts.company) {
        throw new CliError(
          "--company is required",
          ["The Pax8 contacts API is scoped to a single company"],
          [
            `Pick a company first: ${replCmd("pax8 companies list")}`,
            `Then: ${replCmd("pax8 contacts list")} --company <id|name>`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      spinner.start();
      const company = await resolveCompany(ctx, allOpts.company);
      const apiPage = Math.max(parseInt(allOpts.page, 10) - 1, 0);
      const result = await ctx.api.contacts.list(company.id, {
        page: apiPage,
        size: parseInt(allOpts.size, 10),
      });
      spinner.stop();

      if (allOpts.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      const columns: Column[] = [
        { key: "id", header: "ID", width: 14, format: (v) => chalk.dim(String(v).slice(0, 12)) },
        { key: "firstName", header: "First", width: 14 },
        { key: "lastName", header: "Last", width: 16 },
        { key: "email", header: "Email", width: 38 },
        { key: "types", header: "Types", width: 22, format: (v) => Array.isArray(v) ? v.join(", ") : String(v ?? "") },
        { key: "phone", header: "Phone", width: 18 },
      ];

      output(result.content as unknown as Record<string, unknown>[], { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        process.stderr.write(
          chalk.dim(`\n  ${result.content.length} contacts at ${company.name}\n`)
        );
        if (result.content.length > 0) {
          const first = result.content[0];
          process.stderr.write(chalk.dim("\n  Try next:\n"));
          process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 contacts show ${first.id}`))}  ${chalk.dim("view contact details")}\n`);
        }
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 contacts create --company "${company.name}" --email <email> --first-name <name> --last-name <name>`))}  ${chalk.dim("add a contact")}\n`);
        process.stderr.write("\n");
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list contacts");
    }
  });

