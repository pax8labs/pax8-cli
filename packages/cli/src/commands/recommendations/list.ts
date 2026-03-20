import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "readline";
import { getRecommendations, type Recommendation } from "@pax8/core";
import { buildContext, type CommandContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatCompanyName } from "../../lib/formatters.js";
import { enrichProductNames } from "../../lib/enrich-subscriptions.js";

const columns: Column[] = [
  {
    key: "_num",
    header: "#",
  },
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

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function executeRecommendation(rec: Recommendation, ctx: CommandContext): Promise<void> {
  // Resolve names for preview
  let companyName = rec.companyName;
  let productName = rec.suggestedProducts[0] ?? "Unknown";

  process.stderr.write(chalk.bold(`\n  📦 Order Preview:\n\n`));
  process.stderr.write(`  ${chalk.dim("Company:")}  ${companyName}\n`);
  process.stderr.write(`  ${chalk.dim("Product:")}  ${rec.title}\n`);
  process.stderr.write(`  ${chalk.dim("Seats:")}    ${rec.targetSeats}\n`);
  if (rec.estimatedMrrUplift) {
    process.stderr.write(`  ${chalk.dim("Est. MRR:")} ${chalk.green("+" + formatCurrency(rec.estimatedMrrUplift) + "/mo")}\n`);
  }
  process.stderr.write("\n");

  // Ask for quantity (default to suggested)
  const qtyAnswer = await promptLine(
    `  Quantity? [${rec.targetSeats}] `
  );
  const quantity = qtyAnswer === "" ? rec.targetSeats! : parseInt(qtyAnswer, 10);
  if (isNaN(quantity) || quantity <= 0) {
    process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
    return;
  }

  // Parse order command for IDs
  if (!rec.orderCommand) {
    process.stderr.write(chalk.yellow("  No order command available for this recommendation.\n"));
    process.stderr.write(chalk.dim("  Search for a product manually: ") + chalk.cyan(`pax8 products search "${productName}"`) + "\n\n");
    return;
  }

  const companyMatch = rec.orderCommand.match(/--company\s+(\S+)/);
  const productMatch = rec.orderCommand.match(/--product\s+(\S+)/);
  if (!companyMatch || !productMatch) {
    process.stderr.write(chalk.red("  Could not parse order command.\n\n"));
    return;
  }

  const confirmAnswer = await promptLine(
    `  Place order for ${quantity} seats? [Y/n] `
  );
  if (confirmAnswer !== "" && !confirmAnswer.toLowerCase().startsWith("y")) {
    process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
    return;
  }

  const spinner = createSpinner("Creating order...").start();
  try {
    const order = await ctx.api.orders.create({
      companyId: companyMatch[1],
      lineItems: [{
        productId: productMatch[1],
        quantity,
        billingTerm: "Monthly",
      }],
    });
    spinner.succeed("Order created 🎉");
    process.stdout.write(`\n  Order ID: ${order.id}\n\n`);
  } catch (error) {
    spinner.fail("Order failed");
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(chalk.red(`  ${msg}\n\n`));
  }
}

export const recommendationsListCommand = new Command("list")
  .description("Analyze customer portfolios and recommend products")
  .option("--company <id|name>", "Filter to a specific company")
  .option("--priority <level>", "Filter by priority (high, medium, low)")
  .option("--limit <number>", "Max rows to show in table (default 10)")
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
      // Fetch subscriptions, companies, and enrich product names — all in parallel where possible
      const [subsResult, companiesResult] = await Promise.all([
        ctx.api.subscriptions.list({ size: 1000, status: "Active" }),
        ctx.api.companies.list({ size: 200 }),
      ]);

      // Build company name lookup
      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content as Array<{ id: string; name: string }>) {
        companyNames.set(c.id, c.name);
      }

      // Enrich subscriptions with product names (individual lookups, cached)
      const subs = subsResult.content as Record<string, unknown>[];
      await enrichProductNames(ctx, subs);

      // Also enrich company names on subscriptions
      for (const sub of subs) {
        if (!sub.companyName || String(sub.companyName) === sub.companyId) {
          const name = companyNames.get(String(sub.companyId));
          if (name) sub.companyName = name;
        }
      }

      spinner.stop();

      const report = getRecommendations(subs as any);

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
          chalk.green("\n  ✨ All customers look well-covered — nice work!\n\n")
        );
        return;
      }

      // Number the recs for interactive selection, cap table output
      const limit = parseInt(options.limit, 10) || 10;
      const displayRecs = recs.slice(0, limit);
      const numbered = displayRecs.map((r, i) => ({ ...r, _num: String(i + 1) }));
      output(numbered, { format: "table", columns });

      // Summary footer
      const highCount = recs.filter((r) => r.priority === "high").length;
      const totalUplift = recs.reduce((sum, r) => sum + (r.estimatedMrrUplift ?? 0), 0);
      const actionableCount = recs.filter((r) => r.orderCommand).length;

      if (recs.length > limit) {
        process.stderr.write(chalk.dim(`\n  Showing top ${limit} of ${recs.length} recommendations`) + chalk.dim(` · use --limit ${recs.length} to see all\n`));
      }

      process.stderr.write(
        chalk.dim(
          `\n  ${recs.length} recommendations across ${report.companiesWithGaps} companies`
        )
      );

      if (highCount > 0) {
        process.stderr.write(chalk.red.bold(` — ${highCount} high priority`));
      }

      if (totalUplift > 0) {
        process.stderr.write(
          chalk.green(` — ${formatCurrency(totalUplift)}/mo potential MRR uplift`)
        );
      }

      process.stderr.write("\n");

      if (totalUplift >= 5000) {
        process.stderr.write(chalk.cyan(`\n  💰 That's ${formatCurrency(totalUplift * 12)}/yr waiting to be captured.\n`));
      } else if (totalUplift >= 1000) {
        process.stderr.write(chalk.cyan(`\n  📈 A few conversations could add ${formatCurrency(totalUplift * 12)}/yr to your book.\n`));
      }

      // Interactive: ask user to pick one
      const displayActionable = displayRecs.filter((r) => r.orderCommand).length;
      if (displayActionable > 0 && process.stdin.isTTY) {
        process.stderr.write("\n");
        const answer = await promptLine(
          `  ${chalk.bold("Act on a recommendation?")} Enter # (1-${displayRecs.length}) to order, or press Enter to skip: `
        );

        if (answer !== "") {
          const idx = parseInt(answer, 10) - 1;
          if (idx >= 0 && idx < displayRecs.length) {
            await executeRecommendation(displayRecs[idx], ctx);
          } else {
            process.stderr.write(chalk.yellow(`  Invalid selection.\n\n`));
          }
        } else {
          process.stderr.write("\n");
        }
      } else {
        process.stderr.write("\n");
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to generate recommendations");
    }
  });
