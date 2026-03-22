import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { output, type Column } from "../../lib/output.js";
import { formatStatus, formatDate } from "../../lib/formatters.js";
import { enrichCompanyNames } from "../../lib/enrich-subscriptions.js";

const columns: Column[] = [
  { key: "id", header: "ID", format: (v) => chalk.dim(String(v).slice(0, 8)) },
  { key: "companyName", header: "Company" },
  { key: "orderedBy", header: "Ordered By" },
  { key: "createdDate", header: "Date", format: (v) => formatDate(String(v)) },
  { key: "status", header: "Status", format: (v) => formatStatus(String(v)) },
  { key: "lineItems", header: "Items", format: (v) => String(Array.isArray(v) ? v.length : 0) },
];

export const ordersListCommand = new Command("list")
  .description("List orders")
  .option("--company <id|name>", "Filter by company ID or name")
  .option("--status <status>", "Filter by status (Completed, Processing, Failed, PendingManual)")
  .option("--page <number>", "Page number (zero-based)", "0")
  .option("--size <number>", "Page size", "25")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 orders list
  pax8 orders list --company a1b2c3d4-e5f6-7890-abcd-ef1234567890
  pax8 orders list --status Completed
  pax8 orders list --page 1 --size 25
  pax8 orders list --json`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const spinner = createSpinner("Fetching orders...").start();

    try {
      const ctx = await buildContext(allOpts);
      const params: { page: number; size: number; companyId?: string; status?: string } = {
        page: parseInt(allOpts.page, 10),
        size: parseInt(allOpts.size, 10),
      };
      if (allOpts.company) {
        params.companyId = await resolveCompanyId(ctx, allOpts.company);
      }
      if (allOpts.status) {
        params.status = allOpts.status;
      }

      const [result, companiesResult] = await Promise.all([
        ctx.api.orders.list(params),
        ctx.api.companies.list({ size: 200 }),
      ]);

      // Enrich company names
      const nameMap = new Map((companiesResult.content as Array<{ id: string; name: string }>).map(c => [c.id, c.name]));
      enrichCompanyNames(nameMap, result.content as Record<string, unknown>[]);

      spinner.stop();

      if (allOpts.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      output(result.content, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        process.stderr.write(
          chalk.dim(`\n  ${result.page.totalElements} orders\n\n`)
        );
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to list orders");
    }
  });
