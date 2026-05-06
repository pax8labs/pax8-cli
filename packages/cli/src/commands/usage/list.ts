import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatDate } from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { replCmd } from "../../lib/confirm.js";

export const usageListCommand = new Command("list")
  .description("List usage summaries")
  .option("--company <id|name>", "Filter by company ID or name")
  .option("--month <YYYY-MM>", "Filter by usage month (e.g. 2026-04)")
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", "Page size", "50")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 usage list
  pax8 usage list --company "Redwood Manufacturing"
  pax8 usage list --month 2026-04
  pax8 usage list --json`
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching usage summaries...");

    try {
      spinner.start();
      const companyId = options.company
        ? await resolveCompanyId(ctx, options.company)
        : undefined;
      const apiPage = Math.max(parseInt(options.page, 10) - 1, 0);
      const result = await ctx.api.usage.listSummaries({
        companyId,
        page: apiPage,
        size: parseInt(options.size, 10),
      });
      spinner.stop();

      // The Pax8 API doesn't expose a month/date filter on usage-summaries,
      // so honor --month client-side via the date prefix.
      const month: string | undefined = options.month;
      const summaries = month
        ? result.content.filter((u) => u.date?.startsWith(month))
        : result.content;

      if (globalOpts.idsOnly) {
        for (const item of summaries) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      const columns = [
        { key: "id", header: "ID", width: 12, format: (v: unknown) => String(v).slice(0, 8) },
        { key: "companyName", header: "Company", width: 22 },
        { key: "productName", header: "Product", width: 28 },
        { key: "date", header: "Date", width: 14, format: (v: unknown) => formatDate(String(v)) },
        { key: "quantity", header: "Qty", width: 10 },
        { key: "subtotal", header: "Subtotal", width: 14, format: (v: unknown) => formatCurrency(Number(v)) },
      ];

      output(summaries, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        const total = summaries.reduce((s, u) => s + (u.subtotal ?? 0), 0);
        process.stderr.write(
          chalk.dim(`\n  ${summaries.length} usage summaries · ${formatCurrency(total)} total\n`)
        );
        if (summaries.length > 0) {
          const first = summaries[0] as Record<string, unknown>;
          process.stderr.write(chalk.dim("\n  Try next:\n"));
          process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 usage show ${first.id} --lines`))}  ${chalk.dim("view per-resource breakdown")}\n`);
        }
        process.stderr.write("\n");
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list usage summaries");
    }
  });
