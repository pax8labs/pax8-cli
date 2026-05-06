import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "readline";
import { ALL_SUBS_PAGE_SIZE, getRecommendations, type Recommendation } from "@pax8/core";
import { buildContext, type CommandContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatCompanyName, formatQuantity, calculateMrr } from "../../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";
import { filterRecommendations } from "./filter.js";
import { markWriteInFlight } from "../../lib/signals.js";
import { setTelemetryFields } from "../../lib/telemetry-context.js";

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
    // Resolve commitmentTermId from existing subscription for the SAME product
    let commitmentTermId: string | undefined;
    try {
      const subs = await ctx.api.subscriptions.list({
        companyId: rec.companyId,
        status: "Active",
      });
      const match = subs.content.find((s) =>
        s.productId === productId && s.commitment?.id
      );
      if (match?.commitment?.id) commitmentTermId = match.commitment.id;
    } catch { /* best effort */ }

    const doneOrder = markWriteInFlight("orders");
    let order;
    try {
      order = await ctx.api.orders.create({
        companyId: rec.companyId,
        lineItems: [{
          productId,
          quantity,
          billingTerm: "Monthly",
          ...(commitmentTermId ? { commitmentTermId } : {}),
        }],
      });
    } finally {
      doneOrder();
    }

    // Look up unit price from product pricing
    let unitPrice: number | null = null;
    try {
      const pricing = await ctx.api.products.getPricing(productId).catch(() => null);
      if (pricing && pricing.length > 0) {
        const match = pricing.find((p: { billingTerm: string }) => p.billingTerm === "Monthly")
          ?? pricing[0];
        const ratePrice = match.rates?.[0]?.suggestedRetailPrice
          ?? (match as Record<string, unknown>).suggestedRetailPrice as number | undefined;
        if (ratePrice) unitPrice = ratePrice;
      }
    } catch { /* best effort */ }

    // Calculate cost impact
    const monthlyCost = unitPrice ? calculateMrr(unitPrice, quantity, "Monthly") : null;
    const annualCost = monthlyCost ? Number((monthlyCost * 12).toFixed(2)) : null;

    // Fall back to recommendation's MRR estimate if no pricing found
    const displayMrr = monthlyCost ?? (rec.estimatedMrrUplift
      ? (rec.targetSeats && quantity !== rec.targetSeats
        ? Number((rec.estimatedMrrUplift * (quantity / rec.targetSeats)).toFixed(2))
        : rec.estimatedMrrUplift)
      : null);
    const displayAnnual = annualCost ?? (displayMrr ? Number((displayMrr * 12).toFixed(2)) : null);

    spinner.succeed(`Ordered ${product} for ${rec.companyName} (${quantity} seats)`);

    process.stderr.write("\n");
    process.stderr.write(`  ${chalk.dim("Order ID:".padEnd(18))}${order.id}\n`);
    process.stderr.write(`  ${chalk.dim("Product:".padEnd(18))}${product}\n`);
    process.stderr.write(`  ${chalk.dim("Company:".padEnd(18))}${rec.companyName}\n`);
    process.stderr.write(`  ${chalk.dim("Seats:".padEnd(18))}${formatQuantity(quantity)}\n`);
    if (unitPrice) {
      process.stderr.write(`  ${chalk.dim("Unit price:".padEnd(18))}${formatCurrency(unitPrice)}/seat/mo\n`);
    } else {
      process.stderr.write(`  ${chalk.dim("Unit price:".padEnd(18))}${chalk.dim("—")}\n`);
    }
    if (displayMrr) {
      process.stderr.write(`  ${chalk.dim("Monthly cost:".padEnd(18))}${chalk.green.bold(formatCurrency(displayMrr) + "/mo")}\n`);
    } else {
      process.stderr.write(`  ${chalk.dim("Monthly cost:".padEnd(18))}${chalk.dim("—")}\n`);
    }
    if (displayAnnual) {
      process.stderr.write(`  ${chalk.dim("Annual cost:".padEnd(18))}${chalk.green(formatCurrency(displayAnnual) + "/yr")}\n`);
    } else {
      process.stderr.write(`  ${chalk.dim("Annual cost:".padEnd(18))}${chalk.dim("—")}\n`);
    }
    process.stderr.write("\n");
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
        ctx.api.subscriptions.list({ size: ALL_SUBS_PAGE_SIZE, status: "Active" }),
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

      // Contribute aggregate counts to the single command_executed event
      // emitted by the postAction hook (#146 — was double-firing).
      setTelemetryFields({
        recs_presented: recs.length,
        recs_ordered: ordered,
        recs_skipped: skipped,
        recs_mrr_captured: mrrCaptured > 0 ? mrrCaptured : undefined,
      });
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to process recommendations");
    }
  });
