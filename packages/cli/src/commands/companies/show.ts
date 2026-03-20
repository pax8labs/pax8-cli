import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { formatStatus } from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";

const subscriptionColumns: Column[] = [
  { key: "productName", header: "Product" },
  { key: "quantity", header: "Qty" },
  { key: "status", header: "Status", format: (v) => formatStatus(String(v)) },
  { key: "billingTerm", header: "Term" },
  { key: "price", header: "Price", format: (v) => `$${Number(v).toFixed(2)}` },
];

export const companiesShowCommand = new Command("show")
  .description("Show company details")
  .argument("<id|name>", "Company ID or name")
  .option("--subscriptions", "Include company subscriptions")
  .addHelpText(
    "after",
    `
Examples:
  pax8 companies show "Summit Healthcare Partners"
  pax8 companies show "Summit Healthcare Partners" --subscriptions
  pax8 companies show a1b2c3d4-e5f6-7890-abcd-ef1234567890 --json`
  )
  .action(async (idOrName: string, options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const spinner = createSpinner("Fetching company...").start();

    try {
      const ctx = await buildContext(allOpts);
      const id = await resolveCompanyId(ctx, idOrName);
      const company = await ctx.api.companies.get(id);

      spinner.stop();

      if (ctx.outputFormat === "json") {
        if (allOpts.subscriptions) {
          const subs = await ctx.api.subscriptions.list({ companyId: id });
          process.stdout.write(
            JSON.stringify({ ...company, subscriptions: subs.content }, null, 2) + "\n"
          );
        } else {
          process.stdout.write(JSON.stringify(company, null, 2) + "\n");
        }
        return;
      }

      if (ctx.outputFormat === "csv") {
        output([company], {
          format: "csv",
          columns: [
            { key: "name", header: "Name" },
            { key: "id", header: "ID" },
            { key: "status", header: "Status" },
            { key: "phone", header: "Phone" },
            { key: "website", header: "Website" },
          ],
        });
        return;
      }

      // Table / detail view
      process.stdout.write("\n");
      process.stdout.write(chalk.bold(`  ${company.name}\n\n`));
      process.stdout.write(`  ${chalk.dim("ID:")}       ${company.id}\n`);
      process.stdout.write(`  ${chalk.dim("Status:")}   ${formatStatus(company.status)}\n`);
      process.stdout.write(`  ${chalk.dim("Phone:")}    ${company.phone || chalk.dim("—")}\n`);
      process.stdout.write(`  ${chalk.dim("Website:")}  ${company.website || chalk.dim("—")}\n`);
      if (company.address) {
        const addr = company.address;
        const parts = [addr.city, addr.stateOrProvince, addr.postalCode, addr.country].filter(Boolean);
        process.stdout.write(`  ${chalk.dim("Address:")}  ${addr.street || ""}\n`);
        if (parts.length > 0) {
          process.stdout.write(`             ${parts.join(", ")}\n`);
        }
      }
      process.stdout.write(`  ${chalk.dim("Created:")}  ${company.createdDate}\n`);
      process.stdout.write("\n");

      if (allOpts.subscriptions) {
        const subs = await ctx.api.subscriptions.list({ companyId: id });
        if (subs.content.length > 0) {
          process.stdout.write(chalk.dim(`  Subscriptions (${subs.content.length}):\n\n`));
          output(subs.content, { format: "table", columns: subscriptionColumns });
          process.stdout.write("\n");
        } else {
          process.stdout.write(chalk.dim("  No subscriptions found.\n\n"));
        }
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to show company");
    }
  });
