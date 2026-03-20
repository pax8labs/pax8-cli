import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatQuantity } from "../../lib/formatters.js";
import { auditInvoices } from "@pax8/core";

export const invoicesAuditCommand = new Command("audit")
  .description("Audit invoices against active subscriptions")
  .option("--month <YYYY-MM>", "Filter by month (YYYY-MM)")
  .addHelpText(
    "after",
    `
Examples:
  pax8 invoices audit
  pax8 invoices audit --month 2026-03
  pax8 invoices audit --json`
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching invoices...");

    try {
      spinner.start();

      // Fetch all invoice items for the period
      const itemsResult = await ctx.api.invoices.listItems({
        month: options.month,
        size: 500,
      });

      // Fetch all active subscriptions
      const subsResult = await ctx.api.subscriptions.list({
        size: 500,
      });

      spinner.stop();

      // Normalize subscriptions for audit matching:
      // The auditor matches on subscriptionId first, falling back to companyId+productId.
      // Invoice items don't have subscriptionId, so we map subscriptions to use
      // companyId+productId matching by omitting the id field and setting subscriptionId undefined.
      const normalizedSubs = subsResult.content.map((s) => {
        const { id, ...rest } = s;
        return {
          ...rest,
          subscriptionId: undefined,
          unitPrice: s.price,
        };
      });

      // Run audit
      const report = auditInvoices(itemsResult.content, normalizedSubs);

      // JSON output
      if (ctx.outputFormat === "json") {
        output([report], { format: "json" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      // CSV output
      if (ctx.outputFormat === "csv") {
        const columns = [
          { key: "companyName", header: "Company" },
          { key: "productName", header: "Product" },
          { key: "invoicedQuantity", header: "Invoiced Qty" },
          { key: "activeQuantity", header: "Active Qty" },
          { key: "delta", header: "Delta" },
          { key: "dollarImpact", header: "Dollar Impact" },
          { key: "type", header: "Type" },
        ];
        output(report.discrepancies, { format: "csv", columns });
        return;
      }

      // Human-readable audit report
      const monthLabel = options.month
        ? formatMonthLabel(options.month)
        : "current";

      if (report.discrepancies.length === 0) {
        process.stdout.write(
          `\n  ${chalk.green("✓")} No discrepancies found in ${monthLabel} invoices.\n\n`
        );
        return;
      }

      process.stdout.write(
        `\n  ${chalk.yellow("⚠")} ${report.discrepancies.length} discrepancies found in ${monthLabel} invoices:\n\n`
      );

      for (const d of report.discrepancies) {
        process.stdout.write(
          `  ${chalk.bold(d.companyName)} — ${d.productName}\n`
        );

        const deltaSign = d.delta > 0 ? "+" : "";
        const impactLabel =
          d.dollarImpact > 0
            ? `${formatCurrency(d.dollarImpact)} overcharge`
            : `${formatCurrency(Math.abs(d.dollarImpact))} undercharge`;

        process.stdout.write(
          `    Invoiced: ${formatQuantity(d.invoicedQuantity)}    Active: ${formatQuantity(d.activeQuantity)}    Δ ${deltaSign}${d.delta} (${impactLabel})\n`
        );
        process.stdout.write("\n");
      }

      // Footer with totals
      process.stdout.write(chalk.dim("  ─────────────────────────────\n"));
      if (report.totalOvercharge > 0) {
        process.stdout.write(
          `  ${chalk.red("Overcharges:")}  ${formatCurrency(report.totalOvercharge)}\n`
        );
      }
      if (report.totalUndercharge > 0) {
        process.stdout.write(
          `  ${chalk.yellow("Undercharges:")} ${formatCurrency(report.totalUndercharge)}\n`
        );
      }
      process.stdout.write(
        `  ${chalk.bold("Net impact:")}   ${formatCurrency(report.netImpact)}\n`
      );
      process.stdout.write("\n");
    } catch (error) {
      handleCommandError(error, spinner, "Failed to audit invoices");
    }
  });

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  const date = new Date(parseInt(year), parseInt(m) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
