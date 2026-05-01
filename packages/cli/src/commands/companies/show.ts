import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { formatCurrency, formatStatus } from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { resolveFromLastList } from "../../lib/last-list.js";
import { enrichProductNames } from "../../lib/enrich-subscriptions.js";

const subscriptionColumns: Column[] = [
  { key: "productName", header: "Product" },
  { key: "quantity", header: "Qty" },
  { key: "status", header: "Status", format: (v) => formatStatus(String(v)) },
  { key: "billingTerm", header: "Term" },
  { key: "price", header: "Price", format: (v) => formatCurrency(Number(v)) },
];

export const companiesShowCommand = new Command("show")
  .description("Show company details")
  .argument("<id|name>", "Company ID or name")
  .allowExcessArguments(true)
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

    // Rejoin excess args when user forgets quotes
    if (command.args.length > 1) {
      idOrName = command.args.join(" ");
    }

    // Resolve numbered reference from last `companies list`
    const fromList = await resolveFromLastList(idOrName);
    if (fromList) {
      idOrName = fromList.id;
    }

    const spinner = createSpinner("Fetching company...").start();

    try {
      const ctx = await buildContext(allOpts);
      const id = await resolveCompanyId(ctx, idOrName);
      const company = await ctx.api.companies.get(id);

      spinner.stop();

      if (ctx.outputFormat === "json") {
        if (allOpts.subscriptions) {
          const subs = await ctx.api.subscriptions.list({ companyId: id });
          await enrichProductNames(ctx, subs.content as Record<string, unknown>[]);
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
      process.stdout.write(`  ${chalk.dim("ID:".padEnd(18))}${company.id}\n`);
      process.stdout.write(`  ${chalk.dim("Status:".padEnd(18))}${formatStatus(company.status)}\n`);
      process.stdout.write(`  ${chalk.dim("Phone:".padEnd(18))}${company.phone || chalk.dim("—")}\n`);
      process.stdout.write(`  ${chalk.dim("Website:".padEnd(18))}${company.website || chalk.dim("—")}\n`);
      if (company.address) {
        const addr = company.address;
        const parts = [addr.city, addr.stateOrProvince, addr.postalCode, addr.country].filter(Boolean);
        process.stdout.write(`  ${chalk.dim("Address:".padEnd(18))}${addr.street || ""}\n`);
        if (parts.length > 0) {
          process.stdout.write(`  ${"".padEnd(18)}${parts.join(", ")}\n`);
        }
      }
      process.stdout.write(`  ${chalk.dim("Created:".padEnd(18))}${company.createdDate}\n`);
      process.stdout.write("\n");

      if (allOpts.subscriptions) {
        const subs = await ctx.api.subscriptions.list({ companyId: id });
        await enrichProductNames(ctx, subs.content as Record<string, unknown>[]);
        if (subs.content.length > 0) {
          process.stdout.write(chalk.dim(`  Subscriptions (${subs.content.length}):\n\n`));
          output(subs.content, { format: "table", columns: subscriptionColumns });
          process.stdout.write("\n");
        } else {
          process.stdout.write(chalk.dim("  No active subscriptions.\n\n"));
        }
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to show company");
    }
  });
