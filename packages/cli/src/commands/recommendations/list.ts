import { Command } from "commander";
import chalk from "chalk";
import { getRecommendations } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatCompanyName } from "../../lib/formatters.js";

const columns: Column[] = [
  {
    key: "priority",
    header: "Priority",
    format: (v) => {
      const p = String(v);
      if (p === "high") return chalk.red.bold("HIGH");
      if (p === "medium") return chalk.yellow("MED");
      return chalk.dim("LOW");
    },
  },
  {
    key: "companyName",
    header: "Company",
    format: (v) => formatCompanyName(String(v)),
  },
  { key: "type", header: "Type", format: (v) => String(v) === "seat_gap" ? "Seat Gap" : "Cross-sell" },
  { key: "title", header: "Recommendation" },
  {
    key: "estimatedMrrUplift",
    header: "Est. MRR+",
    format: (v) => (v != null ? formatCurrency(v as number) : chalk.dim("—")),
  },
];

export const recommendationsListCommand = new Command("list")
  .description("Analyze customer portfolios and recommend products")
  .option("--company <id|name>", "Filter to a specific company")
  .option("--priority <level>", "Filter by priority (high, medium, low)")
  .addHelpText(
    "after",
    `
Examples:
  pax8 recommendations list
  pax8 recommendations list --priority high
  pax8 recommendations list --company "Summit Healthcare"
  pax8 recommendations list --json`
  )
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Analyzing customer portfolios...").start();

    try {
      // Fetch all active subscriptions and products
      const [subsResult, productsResult] = await Promise.all([
        ctx.api.subscriptions.list({ size: 1000, status: "Active" }),
        ctx.api.products.list({ size: 200 }),
      ]);

      spinner.stop();

      const report = getRecommendations(
        subsResult.content,
        productsResult.content as Array<{ id: string; name: string; vendorName?: string; pricing?: Array<{ billingTerm: string; suggestedRetailPrice: number }> }>,
      );

      let recs = report.recommendations;

      // Filter by company if specified
      if (options.company) {
        const filter = options.company.toLowerCase();
        recs = recs.filter(
          (r) =>
            r.companyId === options.company ||
            r.companyName.toLowerCase().includes(filter)
        );
      }

      // Filter by priority if specified
      if (options.priority) {
        recs = recs.filter((r) => r.priority === options.priority.toLowerCase());
      }

      if (ctx.outputFormat === "json") {
        output(recs, { format: "json" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      if (ctx.outputFormat === "csv") {
        output(recs, { format: "csv", columns });
        return;
      }

      if (recs.length === 0) {
        process.stdout.write(
          chalk.green("\n  All customers look well-covered — no recommendations at this time.\n\n")
        );
        return;
      }

      output(recs, { format: "table", columns });

      // Summary footer
      const highCount = recs.filter((r) => r.priority === "high").length;
      const totalUplift = recs.reduce((sum, r) => sum + (r.estimatedMrrUplift ?? 0), 0);

      process.stdout.write(
        chalk.dim(
          `\n  ${recs.length} recommendations across ${report.companiesWithGaps} companies`
        )
      );

      if (highCount > 0) {
        process.stdout.write(chalk.red.bold(` — ${highCount} high priority`));
      }

      if (totalUplift > 0) {
        process.stdout.write(
          chalk.green(` — ${formatCurrency(totalUplift)}/mo potential MRR uplift`)
        );
      }

      process.stdout.write("\n");

      // Show actionable tip
      process.stdout.write(
        chalk.dim(
          `\n  Tip: Use ${chalk.cyan("--json")} to get order commands you can execute directly.\n`
        )
      );

      process.stdout.write("\n");
    } catch (error) {
      handleCommandError(error, spinner, "Failed to generate recommendations");
    }
  });
