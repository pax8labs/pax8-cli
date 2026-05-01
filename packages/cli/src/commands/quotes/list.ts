import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatDate, formatCurrency } from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { replCmd } from "../../lib/confirm.js";
import type { Quote } from "@pax8/core";

function quoteTotal(q: Quote): number {
  if (!q.lineItems) return 0;
  return q.lineItems.reduce((s, li) => s + (li.subtotal ?? (li.unitPrice ?? 0) * li.quantity), 0);
}

export const quotesListCommand = new Command("list")
  .description("List sales quotes")
  .option("--company <id|name>", "Filter by company ID or name")
  .option("--status <status>", "Filter by status (Draft, Sent, Accepted, Declined)")
  .option("--page <number>", "Page number (0-based)", "0")
  .option("--size <number>", "Page size", "50")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 quotes list
  pax8 quotes list --company "Summit Healthcare Partners"
  pax8 quotes list --status Sent
  pax8 quotes list --json`
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching quotes...");

    try {
      spinner.start();
      const companyId = options.company
        ? await resolveCompanyId(ctx, options.company)
        : undefined;
      const result = await ctx.api.quotes.list({
        companyId,
        page: parseInt(options.page, 10),
        size: parseInt(options.size, 10),
      });
      spinner.stop();

      // The Pax8 API doesn't expose a status filter on quotes list,
      // so honor --status client-side.
      const status: string | undefined = options.status;
      const quotes = status
        ? result.content.filter((q) => q.status?.toLowerCase() === status.toLowerCase())
        : result.content;

      if (globalOpts.idsOnly) {
        for (const item of quotes) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      const enriched = quotes.map((q) => ({
        ...q,
        _total: quoteTotal(q),
        _items: q.lineItems?.length ?? 0,
      }));

      const columns: Column[] = [
        { key: "id", header: "ID", width: 14, format: (v) => chalk.dim(String(v).slice(0, 12)) },
        { key: "companyId", header: "Company ID", width: 14, format: (v) => chalk.dim(String(v).slice(0, 12)) },
        { key: "status", header: "Status", width: 12 },
        { key: "createdDate", header: "Created", width: 14, format: (v) => formatDate(String(v)) },
        { key: "expirationDate", header: "Expires", width: 14, format: (v) => v ? formatDate(String(v)) : "—" },
        { key: "_items", header: "Items", width: 7 },
        { key: "_total", header: "Total", width: 12, format: (v) => formatCurrency(Number(v)) },
      ];

      output(enriched as unknown as Record<string, unknown>[], { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        const total = enriched.reduce((s, q) => s + q._total, 0);
        process.stderr.write(
          chalk.dim(`\n  ${enriched.length} quotes · ${formatCurrency(total)} total\n`)
        );
        if (enriched.length > 0) {
          const first = enriched[0];
          process.stderr.write(chalk.dim("\n  Try next:\n"));
          process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 quotes show ${first.id}`))}  ${chalk.dim("view quote details")}\n`);
        }
        process.stderr.write("\n");
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to list quotes");
    }
  });
