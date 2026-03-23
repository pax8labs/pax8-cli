import { Command } from "commander";
import chalk from "chalk";
import { getRecommendations, type Recommendation } from "@pax8/core";
import { buildContext, ALL_SUBS_SIZE, type CommandContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatCompanyName, formatQuantity } from "../../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";
import { filterRecommendations } from "./filter.js";
import { replCmd } from "../../lib/confirm.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";

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
  const { createInterface } = await import("readline");
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

  // If no order command, run a product search to help the user find one
  if (!rec.orderCommand) {
    process.stderr.write(chalk.bold(`\n  📦 ${productName} for ${companyName}\n\n`));
    const searchTerm = rec.suggestedProducts?.[0] ?? productName;
    process.stderr.write(chalk.dim(`  Searching for "${searchTerm}"...\n\n`));
    const { spawn } = await import("child_process");
    await new Promise<void>((resolve) => {
      const child = spawn("pax8", ["products", "search", searchTerm], { stdio: "inherit", env: process.env });
      child.on("close", () => resolve());
    });
    return;
  }

  const companyMatch = rec.orderCommand.match(/--company\s+"([^"]+)"|--company\s+(\S+)/);
  const productMatch = rec.orderCommand.match(/--product\s+"([^"]+)"|--product\s+(\S+)/);
  if (!companyMatch || !productMatch) {
    process.stderr.write(chalk.red("  Could not parse order command.\n\n"));
    return;
  }

  let quantity = rec.targetSeats ?? 1;

  process.stderr.write(chalk.bold(`\n  📦 Order Preview:\n\n`));
  process.stderr.write(`  ${chalk.dim("Company:")}  ${companyName}\n`);
  process.stderr.write(`  ${chalk.dim("Product:")}  ${productName}\n`);
  process.stderr.write(`  ${chalk.dim("Seats:")}    ${quantity}\n`);
  if (rec.estimatedMrrUplift) {
    process.stderr.write(`  ${chalk.dim("Est. MRR:")} ${chalk.green("+" + formatCurrency(rec.estimatedMrrUplift) + "/mo")}\n`);
  }
  process.stderr.write("\n");

  const confirmAnswer = await promptLine(
    `  Place order for ${formatQuantity(quantity)}? [y/n/c] `
  );
  const answer = confirmAnswer.toLowerCase();
  if (answer === "c" || answer === "change") {
    const qtyAnswer = await promptLine(`  Quantity? [${quantity}] `);
    if (qtyAnswer === "") {
      // keep default
    } else {
      const parsed = parseInt(qtyAnswer, 10);
      if (isNaN(parsed) || parsed <= 0) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }
      quantity = parsed;
    }
    // Confirm with new quantity
    const reconfirm = await promptLine(`  Place order for ${formatQuantity(quantity)}? [y/n] `);
    if (reconfirm !== "" && !reconfirm.toLowerCase().startsWith("y")) {
      process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
      return;
    }
  } else if (answer !== "" && !answer.startsWith("y")) {
    process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
    return;
  }

  // Use companyId directly from the rec (already resolved)
  // Resolve product: try the matched value as an ID first, fall back to search by name
  const matchedProductVal = productMatch[1] ?? productMatch[2];
  let productId = matchedProductVal;
  if (matchedProductVal && !/^[0-9a-f-]{8,}$/i.test(matchedProductVal) && !matchedProductVal.startsWith("prod-")) {
    try {
      const searchResult = await ctx.api.products.search(matchedProductVal);
      const found = searchResult.content.find(
        (p: { name: string; id: string }) => p.name.toLowerCase() === matchedProductVal.toLowerCase()
      );
      if (found) productId = found.id;
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
    spinner.succeed("Order created 🎉");

    process.stdout.write("\n");
    process.stdout.write(`  ${chalk.dim("Order ID:".padEnd(18))}${order.id}\n`);
    process.stdout.write(`  ${chalk.dim("Product:".padEnd(18))}${productName}\n`);
    process.stdout.write(`  ${chalk.dim("Company:".padEnd(18))}${companyName}\n`);
    process.stdout.write(`  ${chalk.dim("Seats:".padEnd(18))}${quantity}\n`);
    if (rec.estimatedMrrUplift) {
      // Scale MRR estimate proportionally if quantity was changed
      const mrrEstimate = rec.targetSeats && quantity !== rec.targetSeats
        ? rec.estimatedMrrUplift * (quantity / rec.targetSeats)
        : rec.estimatedMrrUplift;
      process.stdout.write(`  ${chalk.dim("Est. MRR:".padEnd(18))}${chalk.green.bold("+" + formatCurrency(mrrEstimate) + "/mo")} (${chalk.green("+" + formatCurrency(mrrEstimate * 12) + "/yr")})\n`);
    }
    process.stdout.write("\n");
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
  .option("--type <type>", "Filter by type (seat_gap or cross_sell)")
  .option("--product <name>", "Filter by product name (e.g. 'AvePoint', 'Entra')")
  .option("--include-all", "Show all recommendations including ones without orderable products")
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
  .allowExcessArguments(true)
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();

    // When the user forgets quotes (e.g. --company [DEMO] Client 52),
    // Commander only captures "[DEMO]" and the rest become excess args.
    // Rejoin them so the filter works as intended.
    if (options.company && cmd.args.length > 0) {
      options.company = [options.company, ...cmd.args].join(" ");
    }

    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Analyzing customer portfolios...").start();

    try {
      // Fetch subscriptions, companies, and enrich product names — all in parallel where possible
      const [subsResult, companiesResult] = await Promise.all([
        ctx.api.subscriptions.list({ size: ALL_SUBS_SIZE, status: "Active" }),
        ctx.api.companies.list({ size: 200 }),
      ]);

      // Build company name lookup
      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) {
        companyNames.set(c.id, c.name);
      }

      // Enrich subscriptions with product names (individual lookups, cached)
      const subs = subsResult.content;
      await enrichProductNames(ctx, subs);

      // Also enrich company names on subscriptions
      enrichCompanyNames(companyNames, subs);

      spinner.stop();

      // Fetch products for order command matching
      const productsResult = await ctx.api.products.list({ size: 200 });
      const report = getRecommendations(
        subs,
        productsResult.content,
      );

      let recs = report.recommendations;

      recs = filterRecommendations(recs, options);

      if (ctx.outputFormat === "json") {
        const nextActions = recs
          .filter((r) => r.orderCommand)
          .slice(0, 5)
          .map((r) => ({
            command: r.orderCommand!,
            description: `${r.title} for ${r.companyName}`,
          }));
        process.stdout.write(JSON.stringify({ recommendations: recs, nextActions }, null, 2) + "\n");
        return;
      }

      // In table mode, hide unavailable recs unless --include-all
      const unavailableCount = recs.filter((r) => !r.productAvailable).length;
      if (!options.includeAll) {
        recs = recs.filter((r) => r.productAvailable);
      }

      if (ctx.outputFormat === "quiet") return;

      if (ctx.outputFormat === "csv") {
        output(recs, { format: "csv", columns });
        return;
      }

      if (recs.length === 0) {
        if (unavailableCount > 0) {
          process.stderr.write(
            chalk.yellow(`\n  ${unavailableCount} gap${unavailableCount > 1 ? "s" : ""} found but the needed products aren't in your catalog yet.\n\n`) +
            chalk.dim("  Your customers could benefit from:\n")
          );
          // Show what categories are missing
          const missingCategories = new Set(report.recommendations.filter((r) => !r.productAvailable).map((r) => r.title.replace(/for .+$/, "").trim()));
          for (const cat of missingCategories) {
            process.stderr.write(chalk.dim(`    • ${cat}\n`));
          }
          process.stderr.write(chalk.dim(`\n  Ask your Pax8 rep to enable these product categories.\n`));
          process.stderr.write(chalk.dim(`  Use ${chalk.cyan("--include-all")} to see details.\n\n`));
        } else {
          process.stdout.write(
            chalk.green("\n  ✨ All customers look well-covered — nice work!\n\n")
          );
        }
        return;
      }

      // Number the recs for interactive selection, cap table output
      // If total recs fit comfortably (≤15), show them all regardless of limit
      const requestedLimit = parseInt(options.limit, 10) || 10;
      const limit = recs.length <= 15 ? recs.length : requestedLimit;
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

      const filteredCompanyCount = new Set(recs.map((r) => r.companyId)).size;
      process.stderr.write(
        chalk.dim(
          `\n  ${recs.length} recommendation${recs.length !== 1 ? "s" : ""} across ${filteredCompanyCount} ${filteredCompanyCount !== 1 ? "companies" : "company"}`
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

      // Show actionable commands — copy-paste ready (cap at 5)
      const quickActionCount = Math.min(displayRecs.length, 5);
      process.stderr.write(chalk.dim("\n  Quick actions:\n\n"));
      for (let i = 0; i < quickActionCount; i++) {
        const rec = displayRecs[i];
        const product = rec.suggestedProducts?.[0] ?? "product";
        const seats = rec.targetSeats ?? "?";
        const uplift = rec.estimatedMrrUplift ? chalk.green(` +${formatCurrency(rec.estimatedMrrUplift)}/mo`) : "";
        process.stderr.write(`  ${chalk.cyan.bold(`${i + 1}.`)} ${product} for ${rec.companyName} (${seats} seats)${uplift}\n`);
        if (rec.orderCommand) {
          process.stderr.write(chalk.dim(`     ${replCmd(rec.orderCommand)}\n\n`));
        }
      }

      if (unavailableCount > 0) {
        process.stderr.write(chalk.dim(`  ${unavailableCount} more recommendation${unavailableCount > 1 ? "s" : ""} hidden — no orderable products in catalog yet\n`));
      }

      // Suggest recommendations act
      process.stderr.write(chalk.dim(`  Walk through all: `) + chalk.cyan(replCmd("pax8 recommendations act")) + "\n");

      // Save pending actions for REPL mode
      try {
        const { writeFileSync, mkdirSync } = await import("fs");
        const { homedir } = await import("os");
        const { join } = await import("path");
        const dir = join(homedir(), ".pax8");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "pending-actions.json"), JSON.stringify(
          displayRecs.map((r, i) => ({
            key: String(i + 1),
            rec: { companyId: r.companyId, companyName: r.companyName, title: r.title, orderCommand: r.orderCommand, suggestedProducts: r.suggestedProducts, targetSeats: r.targetSeats },
          }))
        ));
      } catch { /* best effort */ }

      // Interactive prompt — use shared promptNextSteps
      const steps: NextStep[] = displayRecs.map((r, i) => {
        if (r.orderCommand) {
          // Tokenize orderCommand, strip leading "pax8" if present
          const tokens = r.orderCommand.match(/"[^"]*"|\S+/g) ?? [];
          const command = tokens[0] === "pax8" ? tokens.slice(1) : tokens;
          return {
            key: String(i + 1),
            label: `${r.suggestedProducts?.[0] ?? "product"} for ${r.companyName}`,
            command,
          };
        }
        return {
          key: String(i + 1),
          label: `Search for ${r.suggestedProducts?.[0] ?? "product"}`,
          command: ["products", "search", r.suggestedProducts?.[0] ?? "product"],
        };
      });
      await promptNextSteps(steps);
    } catch (error) {
      handleCommandError(error, spinner, "Failed to generate recommendations");
    }
  });
