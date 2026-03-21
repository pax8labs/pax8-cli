import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "readline";
import { getRecommendations, type Recommendation } from "@pax8/core";
import { buildContext, type CommandContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatCompanyName } from "../../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

async function actOnRec(rec: Recommendation, index: number, total: number, ctx: CommandContext): Promise<"ordered" | "skipped" | "quit"> {
  const product = rec.suggestedProducts?.[0] ?? "product";
  const seats = rec.targetSeats ?? "?";
  const uplift = rec.estimatedMrrUplift ? chalk.green(` +${formatCurrency(rec.estimatedMrrUplift)}/mo`) : "";

  process.stderr.write(chalk.bold(`\n  [${index + 1}/${total}] ${rec.companyName}\n`));
  process.stderr.write(`  ${rec.type === "seat_gap" ? "Seat Gap" : "Cross-sell"}: ${product} (${seats} seats)${uplift}\n`);
  process.stderr.write(chalk.dim(`  ${rec.reason.slice(0, 120)}\n`));

  if (!rec.orderCommand) {
    process.stderr.write(chalk.dim("\n  No orderable product available — skipping.\n"));
    return "skipped";
  }

  const answer = await prompt(`\n  ${chalk.cyan("[y]")} order  ${chalk.dim("[s] skip")}  ${chalk.dim("[q] quit")}  > `);

  if (answer === "q" || answer === "quit") return "quit";
  if (answer !== "y" && answer !== "yes" && answer !== "") return "skipped";

  // Parse and execute order
  const companyMatch = rec.orderCommand.match(/--company\s+(\S+)/);
  const productMatch = rec.orderCommand.match(/--product\s+(\S+)/);
  const qtyMatch = rec.orderCommand.match(/--quantity\s+(\S+)/);
  if (!companyMatch || !productMatch) {
    process.stderr.write(chalk.red("  Could not parse order.\n"));
    return "skipped";
  }

  const quantity = parseInt(qtyMatch?.[1] ?? String(rec.targetSeats ?? 1), 10);

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
    spinner.succeed(`Ordered ${product} for ${rec.companyName} (${quantity} seats)`);
    return "ordered";
  } catch (error) {
    spinner.fail("Order failed");
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(chalk.dim(`  ${msg.slice(0, 100)}\n`));
    return "skipped";
  }
}

export const recommendationsActCommand = new Command("act")
  .description("Walk through recommendations one by one and place orders")
  .option("--company <id|name>", "Filter to a specific company")
  .option("--product <name>", "Filter to a specific product (e.g. 'AvePoint', 'Entra')")
  .option("--priority <level>", "Filter by priority (high, medium, low)")
  .allowExcessArguments(true)
  .addHelpText(
    "after",
    `
Examples:
  pax8 recommendations act
  pax8 recommendations act --company "Summit Healthcare"
  pax8 recommendations act --priority high`
  )
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();

    // Rejoin excess args for unquoted company names
    if (options.company && cmd.args.length > 0) {
      options.company = [options.company, ...cmd.args].join(" ");
    }

    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Analyzing portfolios...").start();

    try {
      const [subsResult, companiesResult] = await Promise.all([
        ctx.api.subscriptions.list({ size: 1000, status: "Active" }),
        ctx.api.companies.list({ size: 200 }),
      ]);

      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) {
        companyNames.set(c.id, c.name);
      }

      const subs = subsResult.content;
      await enrichProductNames(ctx, subs);
      enrichCompanyNames(companyNames, subs);

      const productsResult = await ctx.api.products.list({ size: 200 });
      const report = getRecommendations(subs, productsResult.content);

      let recs = report.recommendations.filter((r) => r.productAvailable);

      if (options.company) {
        const filter = options.company.toLowerCase();
        recs = recs.filter(
          (r) =>
            r.companyId === options.company ||
            r.companyId.startsWith(filter) ||
            r.companyName.toLowerCase() === filter ||
            r.companyName.toLowerCase() === `[demo] ${filter}` ||
            r.companyName.toLowerCase().includes(filter)
        );
      }

      if (options.priority) {
        recs = recs.filter((r) => r.priority === options.priority.toLowerCase());
      }

      if (options.product) {
        const pFilter = options.product.toLowerCase();
        recs = recs.filter((r) =>
          (r.suggestedProducts?.[0] ?? "").toLowerCase().includes(pFilter) ||
          r.title.toLowerCase().includes(pFilter)
        );
      }

      spinner.stop();

      if (recs.length === 0) {
        process.stderr.write(chalk.green("\n  No actionable recommendations.\n\n"));
        return;
      }

      process.stderr.write(`\n  ${chalk.bold(`${recs.length} recommendations`)} — let's go through them.\n`);
      process.stderr.write(chalk.dim(`  Press y to order, s to skip, q to quit.\n`));

      let ordered = 0;
      let skipped = 0;

      for (let i = 0; i < recs.length; i++) {
        const result = await actOnRec(recs[i], i, recs.length, ctx);
        if (result === "ordered") ordered++;
        if (result === "skipped") skipped++;
        if (result === "quit") break;
      }

      // Summary
      process.stderr.write(chalk.dim("\n  ─────────────────────────────\n"));
      process.stderr.write(`  ${chalk.green.bold(`${ordered} ordered`)}`);
      if (skipped > 0) process.stderr.write(chalk.dim(` · ${skipped} skipped`));
      process.stderr.write("\n\n");
    } catch (error) {
      handleCommandError(error, spinner, "Failed to process recommendations");
    }
  });
