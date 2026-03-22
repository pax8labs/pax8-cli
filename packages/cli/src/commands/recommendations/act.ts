import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "readline";
import { getRecommendations, getTelemetry, type Recommendation } from "@pax8/core";
import { buildContext, type CommandContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatCompanyName } from "../../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";
import { filterRecommendations } from "./filter.js";

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

  const answer = await prompt(`\n  ${chalk.cyan("[y]")} order  ${chalk.dim("[c] change qty")}  ${chalk.dim("[s] skip")}  ${chalk.dim("[q] quit")}  > `);

  if (answer === "q" || answer === "quit") return "quit";
  if (answer !== "y" && answer !== "yes" && answer !== "c" && answer !== "change" && answer !== "") return "skipped";

  // Parse and execute order
  const companyMatch = rec.orderCommand.match(/--company\s+"([^"]+)"|--company\s+(\S+)/);
  const productMatch = rec.orderCommand.match(/--product\s+"([^"]+)"|--product\s+(\S+)/);
  const qtyMatch = rec.orderCommand.match(/--quantity\s+(\S+)/);
  if (!companyMatch || !productMatch) {
    process.stderr.write(chalk.red("  Could not parse order.\n"));
    return "skipped";
  }

  let quantity = parseInt(qtyMatch?.[1] ?? String(rec.targetSeats ?? 1), 10);

  if (answer === "c" || answer === "change") {
    const qtyAnswer = await prompt(`  Quantity? [${quantity}] `);
    if (qtyAnswer !== "") {
      const parsed = parseInt(qtyAnswer, 10);
      if (isNaN(parsed) || parsed <= 0) {
        process.stderr.write(chalk.yellow("  Cancelled.\n"));
        return "skipped";
      }
      quantity = parsed;
    }
  }

  // Use companyId directly from the rec (already resolved)
  // Resolve product: try the matched value as a product ID first, fall back to search
  const matchedProduct = productMatch[1] ?? productMatch[2];
  let productId = matchedProduct;
  // If it doesn't look like a UUID/ID, resolve by name
  if (matchedProduct && !/^[0-9a-f-]{8,}$/i.test(matchedProduct) && !matchedProduct.startsWith("prod-")) {
    try {
      const searchResult = await ctx.api.products.search(matchedProduct);
      const match = searchResult.content.find(
        (p: { name: string; id: string }) => p.name.toLowerCase() === matchedProduct.toLowerCase()
      );
      if (match) productId = match.id;
    } catch { /* use as-is */ }
  }

  const spinner = createSpinner("Creating order...").start();
  try {
    const order = await ctx.api.orders.create({
      companyId: rec.companyId,
      lineItems: [{
        productId,
        quantity,
        billingTerm: "Monthly",
      }],
    });
    // Show financial impact
    let mrrLine = "";
    if (rec.estimatedMrrUplift) {
      const mrrEstimate = rec.targetSeats && quantity !== rec.targetSeats
        ? rec.estimatedMrrUplift * (quantity / rec.targetSeats)
        : rec.estimatedMrrUplift;
      mrrLine = chalk.green(` +${formatCurrency(mrrEstimate)}/mo`);
    }
    spinner.succeed(`Ordered ${product} for ${rec.companyName} (${quantity} seats)${mrrLine}`);
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
      recs = filterRecommendations(recs, options);

      spinner.stop();

      if (recs.length === 0) {
        process.stderr.write(chalk.green("\n  No actionable recommendations.\n\n"));
        return;
      }

      process.stderr.write(`\n  ${chalk.bold(`${recs.length} recommendations`)} — let's go through them.\n`);
      process.stderr.write(chalk.dim(`  Press y to order, s to skip, q to quit.\n`));

      let ordered = 0;
      let skipped = 0;
      let mrrCaptured = 0;

      for (let i = 0; i < recs.length; i++) {
        const result = await actOnRec(recs[i], i, recs.length, ctx);
        if (result === "ordered") {
          ordered++;
          mrrCaptured += recs[i].estimatedMrrUplift ?? 0;
        }
        if (result === "skipped") skipped++;
        if (result === "quit") break;
      }

      // Summary
      process.stderr.write(chalk.dim("\n  ─────────────────────────────\n"));
      process.stderr.write(`  ${chalk.green.bold(`${ordered} ordered`)}`);
      if (skipped > 0) process.stderr.write(chalk.dim(` · ${skipped} skipped`));
      if (mrrCaptured > 0) process.stderr.write(chalk.green(` · ${formatCurrency(mrrCaptured)}/mo MRR captured`));
      process.stderr.write("\n\n");

      // Track recommendation flow
      try {
        const tel = getTelemetry();
        tel.track({
          event: "command_executed",
          command: "recommendations.act",
          flags: [],
          duration_ms: 0,
          success: true,
          cli_version: "0.1.0",
          node_version: process.version,
          os: process.platform,
          demo_mode: process.env.PAX8_DEMO === "1",
          recs_presented: recs.length,
          recs_ordered: ordered,
          recs_skipped: skipped,
          recs_mrr_captured: mrrCaptured > 0 ? mrrCaptured : undefined,
        });
      } catch { /* telemetry never breaks the CLI */ }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to process recommendations");
    }
  });
